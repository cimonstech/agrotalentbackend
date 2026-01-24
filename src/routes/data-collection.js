import express from 'express';
import { getSupabaseClient } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET /api/data-collection - Get data collection jobs
router.get('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const location = req.query.location;
    
    let query = supabase
      .from('jobs')
      .select(`
        *,
        profiles:farm_id (
          id,
          farm_name,
          farm_type,
          farm_location
        )
      `)
      .eq('status', 'active')
      .eq('job_type', 'data_collector')
      .order('created_at', { ascending: false });
    
    if (location) {
      query = query.eq('location', location);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    return res.json({ jobs: data || [] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/data-collection - Create data collection request
router.post('/', authenticate, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();
    
    if (!profile || profile.role !== 'farm') {
      return res.status(403).json({
        error: 'Only employers/farms can create data collection requests'
      });
    }
    
    const {
      title,
      description,
      location,
      address,
      required_specialization,
      number_of_personnel,
      start_date,
      end_date,
      salary_per_person
    } = req.body;
    
    // Create job with job_type = 'data_collector'
    const { data: job, error } = await supabase
      .from('jobs')
      .insert({
        farm_id: req.user.id,
        title: title || 'Data Collection Project',
        description,
        job_type: 'data_collector',
        location,
        address,
        required_specialization,
        salary_min: salary_per_person,
        salary_max: salary_per_person,
        status: 'active'
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
