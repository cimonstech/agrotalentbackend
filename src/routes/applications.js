import express from 'express';
import { getSupabaseClient, getSupabaseAdminClient } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET /api/applications - Get applications (role-based)
router.get('/', authenticate, async (req, res) => {
  try {
    const supabase = req.supabase;
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    let query;
    
    if (profile.role === 'farm') {
      // Farms see applications for their jobs
      // First get farm's job IDs
      const { data: farmJobs } = await supabase
        .from('jobs')
        .select('id')
        .eq('farm_id', req.user.id);
      
      const jobIds = farmJobs?.map(j => j.id) || [];
      
      if (jobIds.length === 0) {
        return res.json({ applications: [] });
      }
      
      query = supabase
        .from('applications')
        .select(`
          *,
          jobs:job_id (
            id,
            title,
            location,
            job_type
          ),
          applicant:applicant_id (
            id,
            full_name,
            email,
            phone,
            qualification,
            institution_name,
            specialization,
            preferred_region,
            is_verified
          )
        `)
        .in('job_id', jobIds)
        .order('match_score', { ascending: false })
        .order('created_at', { ascending: false });
    } else {
      // Graduates/Students see their own applications
      query = supabase
        .from('applications')
        .select(`
          *,
          jobs:job_id (
            id,
            title,
            description,
            location,
            job_type,
            salary_min,
            salary_max,
            profiles:farm_id (
              farm_name,
              farm_type
            )
          )
        `)
        .eq('applicant_id', req.user.id)
        .order('created_at', { ascending: false });
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    return res.json({ applications: data || [] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/applications - Create application
router.post('/', authenticate, async (req, res) => {
  try {
    const supabase = req.supabase;
    // Check if user is verified graduate/student
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_verified')
      .eq('id', req.user.id)
      .single();
    
    if (!profile || !['graduate', 'student'].includes(profile.role)) {
      return res.status(403).json({
        error: 'Only verified graduates and students can apply'
      });
    }
    
    if (!profile.is_verified) {
      return res.status(403).json({
        error: 'Your profile must be verified before applying'
      });
    }
    
    const { job_id, cover_letter } = req.body;
    
    // Check if job exists and is active
    const { data: job } = await supabase
      .from('jobs')
      .select('id, status, max_applications, application_count')
      .eq('id', job_id)
      .single();
    
    if (!job || job.status !== 'active') {
      return res.status(404).json({
        error: 'Job not found or not active'
      });
    }
    
    // Check if already applied
    const { data: existing } = await supabase
      .from('applications')
      .select('id')
      .eq('job_id', job_id)
      .eq('applicant_id', req.user.id)
      .single();
    
    if (existing) {
      return res.status(400).json({
        error: 'You have already applied for this job'
      });
    }
    
    // Create application
    const { data: application, error } = await supabase
      .from('applications')
      .insert({
        job_id,
        applicant_id: req.user.id,
        cover_letter: cover_letter || null,
        status: 'pending'
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // Update job application count
    await supabase
      .from('jobs')
      .update({ application_count: (job.application_count || 0) + 1 })
      .eq('id', job_id);
    
    return res.status(201).json({ application });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// PATCH /api/applications/:id - Update application status
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();
    
    if (!profile || !['farm', 'admin'].includes(profile.role)) {
      return res.status(403).json({
        error: 'Only employers/farms and admins can update application status'
      });
    }
    
    const { status, review_notes } = req.body;
    
    // Get application to verify farm owns the job
    const { data: application } = await supabase
      .from('applications')
      .select(`
        *,
        jobs:job_id (
          farm_id
        )
      `)
      .eq('id', req.params.id)
      .single();
    
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }
    
    // Verify farm owns this job (unless admin)
    if (profile.role === 'farm' && application.jobs.farm_id !== req.user.id) {
      return res.status(403).json({
        error: 'You can only update applications for your own jobs'
      });
    }
    
    // Update application
    const updateData = {
      status,
      reviewed_by: req.user.id,
      reviewed_at: new Date().toISOString()
    };
    
    if (review_notes) {
      updateData.review_notes = review_notes;
    }
    
    // If accepted, create placement
    if (status === 'accepted') {
      const { data: placement, error: placementError } = await supabase
        .from('placements')
        .insert({
          application_id: req.params.id,
          job_id: application.job_id,
          farm_id: application.jobs.farm_id,
          graduate_id: application.applicant_id,
          status: 'pending'
        })
        .select()
        .single();
      
      if (placementError) throw placementError;
      
      // Create payment record
      await supabase
        .from('payments')
        .insert({
          placement_id: placement.id,
          farm_id: application.jobs.farm_id,
          amount: 200.00,
          status: 'pending'
        });
      
      // Update job status
      await supabase
        .from('jobs')
        .update({ status: 'filled' })
        .eq('id', application.job_id);
    }
    
    const { data: updated, error } = await supabase
      .from('applications')
      .update(updateData)
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (error) throw error;
    
    return res.json({ application: updated });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
