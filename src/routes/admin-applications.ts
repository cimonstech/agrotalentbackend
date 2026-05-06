import { Router } from 'express';
import { getSupabaseAdminClient } from '../lib/supabase.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { queryParamToString } from '../lib/query.js';
import { errorMessage } from '../lib/errors.js'

const router = Router();

// GET /api/admin/applications - List all applications
router.get('/applications', authenticate, requireAdmin, async (req, res) => {
  try {
    // Use admin client to bypass RLS
    const supabase = getSupabaseAdminClient();
    const status = queryParamToString(req.query.status);
    const jobId = queryParamToString(req.query.job_id);
    const applicantId = queryParamToString(req.query.applicant_id);
    const page = parseInt(queryParamToString(req.query.page) || '1', 10);
    const limit = parseInt(queryParamToString(req.query.limit) || '50', 10);
    const offset = (page - 1) * limit;
    
    let query = supabase
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
          status,
          profiles:farm_id (
            farm_name,
            farm_type,
            farm_location
          )
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
          is_verified,
          role
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false });
    
    if (status) {
      query = query.eq('status', status);
    }
    
    if (jobId) {
      query = query.eq('job_id', jobId);
    }
    
    if (applicantId) {
      query = query.eq('applicant_id', applicantId);
    }
    
    query = query.range(offset, offset + limit - 1);
    
    const { data: applications, error, count } = await query;
    
    if (error) throw error;
    
    return res.json({
      applications: applications || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

export default router;

