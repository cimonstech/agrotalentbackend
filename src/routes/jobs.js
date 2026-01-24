import express from 'express';
import { getSupabaseClient, getSupabaseAdminClient } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET /api/jobs - List jobs with filters
router.get('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const id = searchParams.get('id');
    const location = searchParams.get('location');
    const jobType = searchParams.get('job_type');
    const specialization = searchParams.get('specialization');
    const status = searchParams.get('status') || 'active';
    
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
      if (status) query = query.eq('status', status);
      if (location) query = query.eq('location', location);
      if (jobType) query = query.eq('job_type', jobType);
      if (specialization) query = query.eq('required_specialization', specialization);
      
      query = query.order('created_at', { ascending: false });
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    if (id) {
      return res.json({ job: data });
    } else {
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
      expires_at
    } = req.body;
    
    if (!title || !description || !job_type || !location) {
      return res.status(400).json({
        error: 'Title, description, job_type, and location are required'
      });
    }
    
    // For admin-posted jobs, we insert via service role to bypass RLS (jobs policy is farm-only).
    // We still set farm_id to admin's profile id to satisfy NOT NULL constraint.
    const insertClient = profile.role === 'admin' ? supabaseAdmin : supabase;

    const { data: job, error } = await insertClient
      .from('jobs')
      .insert({
        farm_id: req.user.id,
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

export default router;
