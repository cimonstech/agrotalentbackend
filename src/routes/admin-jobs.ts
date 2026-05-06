import { Router } from 'express';
import { getSupabaseAdminClient } from '../lib/supabase.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { enforceApplicationDeadlines } from '../services/deadlineEnforcement.js';
import { queryParamToString } from '../lib/query.js';
import { errorMessage } from '../lib/errors.js'

const router = Router();

// GET /api/admin/jobs - List all jobs from all employers
router.get('/jobs', authenticate, requireAdmin, async (req, res) => {
  try {
    // Use admin client to bypass RLS and see all jobs
    const supabaseAdmin = getSupabaseAdminClient();
    const status = req.query.status;
    const farmId = req.query.farm_id;
    const location = req.query.location;
    const jobType = req.query.job_type;
    const page = parseInt(queryParamToString(req.query.page) || '1', 10);
    const limit = parseInt(queryParamToString(req.query.limit) || '100', 10);
    const offset = (page - 1) * limit;
    
    let query = supabaseAdmin
      .from('jobs')
      .select(`
        *,
        profiles:farm_id (
          id,
          farm_name,
          farm_type,
          farm_location,
          email
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false });
    
    // Don't filter by status by default - show all jobs
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }
    
    if (farmId) {
      query = query.eq('farm_id', farmId);
    }
    
    if (location) {
      query = query.eq('location', location);
    }
    
    if (jobType) {
      query = query.eq('job_type', jobType);
    }
    
    query = query.range(offset, offset + limit - 1);
    
    const { data: jobs, error, count } = await query;
    
    if (error) {
      console.error('Error fetching admin jobs:', error);
      throw error;
    }
    
    return res.json({
      jobs: jobs || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Admin jobs fetch error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to fetch jobs' });
  }
});

router.post('/jobs/enforce-deadlines', authenticate, requireAdmin, async (_req, res) => {
  try {
    const result = await enforceApplicationDeadlines();
    return res.json({
      success: true,
      closed: result.closed,
      errors: result.errors,
      message: `${result.closed} job(s) closed due to passed application deadlines.`,
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// DELETE /api/admin/jobs - Delete all jobs (Admin only)
router.delete('/jobs', authenticate, requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { error } = await supabaseAdmin.from('jobs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw error;
    return res.status(204).send();
  } catch (error) {
    console.error('Admin delete all jobs error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to delete jobs' });
  }
});

export default router;

