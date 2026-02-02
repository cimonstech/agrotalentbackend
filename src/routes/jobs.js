import express from 'express';
import { getSupabaseClient, getSupabaseAdminClient } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET /api/jobs - List jobs with filters
router.get('/', async (req, res) => {
  try {
    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const id = searchParams.get('id');
    const location = searchParams.get('location');
    const jobType = searchParams.get('job_type');
    const specialization = searchParams.get('specialization');
    const farmId = searchParams.get('farm_id');
    const status = searchParams.get('status') || 'all';
    
    // If status='all', use admin client to bypass RLS (since RLS only allows viewing 'active' jobs)
    // Otherwise use regular client for RLS-protected queries
    const supabase = status === 'all' 
      ? getSupabaseAdminClient() 
      : getSupabaseClient();
    
    let query = supabase
      .from('jobs')
      .select(`
        *,
        profiles:farm_id (
          id,
          farm_name,
          farm_location,
          farm_type
        )
      `);
    
    if (id) {
      query = query.eq('id', id).single();
    } else {
      if (status && status !== 'all') {
        query = query.eq('status', status);
      }
      // Note: For 'all' status, we'll filter inactive jobs older than 24h after fetching
      if (location) query = query.eq('location', location);
      if (jobType) query = query.eq('job_type', jobType);
      if (specialization) query = query.eq('required_specialization', specialization);
      if (farmId) query = query.eq('farm_id', farmId);
      
      query = query.order('created_at', { ascending: false });
    }
    
    let { data, error } = await query;
    
    if (error) throw error;
    
    if (id) {
      return res.json({ job: data });
    } else {
      // Filter out inactive jobs older than 24 hours for public view
      if (status === 'all' || !status) {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        data = (data || []).filter((job) => {
          // Show job if:
          // 1. Status is not 'inactive', OR
          // 2. Status is 'inactive' but status_changed_at is within last 24 hours (or null)
          if (job.status !== 'inactive') return true;
          if (!job.status_changed_at) return true; // Show if no status_changed_at (backward compatibility)
          const statusChangedAt = new Date(job.status_changed_at);
          return statusChangedAt > twentyFourHoursAgo;
        });
      }
      return res.json({ jobs: data || [] });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/jobs - Create job (Farm or Admin)
router.post('/', authenticate, async (req, res) => {
  try {
    // Use authed client so RLS can see auth.uid()
    const supabase = req.supabase || getSupabaseClient();
    const supabaseAdmin = getSupabaseAdminClient();

    // Check if user is an employer/farm or admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();
    
    if (!profile || (profile.role !== 'farm' && profile.role !== 'admin')) {
      return res.status(403).json({ error: 'Only employers/farms and admins can create jobs' });
    }
    
    const {
      title,
      description,
      job_type,
      location,
      address,
      salary_min,
      salary_max,
      required_qualification,
      required_institution_type,
      required_experience_years,
      required_specialization,
      expires_at,
      farm_id  // For admin to assign job to a specific farm
    } = req.body;
    
    if (!title || !description || !job_type || !location) {
      return res.status(400).json({
        error: 'Title, description, job_type, and location are required'
      });
    }
    
    // Determine farm_id
    let targetFarmId = req.user.id;
    if (profile.role === 'admin') {
      // Admin must specify a farm_id when posting
      if (!farm_id) {
        return res.status(400).json({
          error: 'farm_id is required when admin posts a job. Please select an employer/farm.'
        });
      }
      // Verify the farm exists
      const { data: farmProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, role')
        .eq('id', farm_id)
        .eq('role', 'farm')
        .single();
      
      if (!farmProfile) {
        return res.status(400).json({
          error: 'Invalid farm_id. The specified farm does not exist.'
        });
      }
      targetFarmId = farm_id;
    }
    
    // For admin-posted jobs, we insert via service role to bypass RLS (jobs policy is farm-only).
    const insertClient = profile.role === 'admin' ? supabaseAdmin : supabase;

    const { data: job, error } = await insertClient
      .from('jobs')
      .insert({
        farm_id: targetFarmId,
        title,
        description,
        job_type,
        location,
        address: address || null,
        salary_min: salary_min ? parseFloat(salary_min) : null,
        salary_max: salary_max ? parseFloat(salary_max) : null,
        required_qualification: required_qualification || null,
        required_institution_type: required_institution_type || 'any',
        required_experience_years: required_experience_years || 0,
        required_specialization: required_specialization || null,
        status: 'active',
        expires_at: expires_at || null
      })
      .select()
      .single();
    
    if (error) throw error;
    
    return res.status(201).json({ job });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// PATCH /api/jobs/:id - Update job (Farm or Admin)
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const supabase = req.supabase || getSupabaseClient();
    const supabaseAdmin = getSupabaseAdminClient();

    // Check if user is an employer/farm or admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();
    
    if (!profile || (profile.role !== 'farm' && profile.role !== 'admin')) {
      return res.status(403).json({ error: 'Only employers/farms and admins can update jobs' });
    }
    
    // Get existing job to verify ownership
    const { data: existingJob } = await supabaseAdmin
      .from('jobs')
      .select('farm_id')
      .eq('id', req.params.id)
      .single();
    
    if (!existingJob) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Verify farm owns this job (unless admin)
    if (profile.role === 'farm' && existingJob.farm_id !== req.user.id) {
      return res.status(403).json({
        error: 'You can only update jobs you posted'
      });
    }
    
    const {
      title,
      description,
      job_type,
      location,
      address,
      salary_min,
      salary_max,
      required_qualification,
      required_institution_type,
      required_experience_years,
      required_specialization,
      expires_at,
      status,
      farm_id  // For admin to reassign job to different farm
    } = req.body;
    
    // Build update object
    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (job_type !== undefined) updateData.job_type = job_type;
    if (location !== undefined) updateData.location = location;
    if (address !== undefined) updateData.address = address || null;
    if (salary_min !== undefined) updateData.salary_min = salary_min ? parseFloat(salary_min) : null;
    if (salary_max !== undefined) updateData.salary_max = salary_max ? parseFloat(salary_max) : null;
    if (required_qualification !== undefined) updateData.required_qualification = required_qualification || null;
    if (required_institution_type !== undefined) updateData.required_institution_type = required_institution_type;
    if (required_experience_years !== undefined) updateData.required_experience_years = required_experience_years || 0;
    if (required_specialization !== undefined) updateData.required_specialization = required_specialization || null;
    if (expires_at !== undefined) updateData.expires_at = expires_at || null;
    if (status !== undefined) updateData.status = status;
    
    // Admin can reassign job to different farm
    if (profile.role === 'admin' && farm_id !== undefined) {
      // Verify the farm exists
      const { data: farmProfile } = await supabaseAdmin
        .from('profiles')
        .select('id, role')
        .eq('id', farm_id)
        .eq('role', 'farm')
        .single();
      
      if (!farmProfile) {
        return res.status(400).json({
          error: 'Invalid farm_id. The specified farm does not exist.'
        });
      }
      updateData.farm_id = farm_id;
    }
    
    // Use admin client to avoid RLS blocking farm updates
    const updateClient = supabaseAdmin;
    
    const { data: updated, error } = await updateClient
      .from('jobs')
      .update(updateData)
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (error) throw error;
    
    return res.json({ job: updated });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /api/jobs/:id - Delete job (Farm own jobs or Admin any job)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const supabase = req.supabase || getSupabaseClient();
    const supabaseAdmin = getSupabaseAdminClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (!profile || (profile.role !== 'farm' && profile.role !== 'admin')) {
      return res.status(403).json({ error: 'Only employers/farms and admins can delete jobs' });
    }

    const { data: existingJob } = await supabaseAdmin
      .from('jobs')
      .select('farm_id')
      .eq('id', req.params.id)
      .single();

    if (!existingJob) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (profile.role === 'farm' && existingJob.farm_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete jobs you posted' });
    }

    const { error } = await supabaseAdmin
      .from('jobs')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
