import { Router } from 'express';
import { getSupabaseAdminClient } from '../lib/supabase.js';
import { requireAdmin } from '../middleware/auth.js';
import { queryParamToString } from '../lib/query.js';
import { errorMessage } from '../lib/errors.js'

const router = Router();

// GET /api/admin/placements - List all placements
router.get('/placements', requireAdmin, async (req, res) => {
  try {
    // Use admin client to bypass RLS
    const supabase = getSupabaseAdminClient();
    const status = queryParamToString(req.query.status);
    const region = queryParamToString(req.query.region);
    const startDate = queryParamToString(req.query.start_date);
    const endDate = queryParamToString(req.query.end_date);
    const page = parseInt(queryParamToString(req.query.page) || '1', 10);
    const limit = parseInt(queryParamToString(req.query.limit) || '50', 10);
    const offset = (page - 1) * limit;
    
    let query = supabase
      .from('placements')
      .select(`
        *,
        jobs:job_id (
          id,
          title,
          location,
          job_type
        ),
        farm:farm_id (
          id,
          farm_name,
          farm_location
        ),
        graduate:graduate_id (
          id,
          full_name,
          email,
          preferred_region,
          qualification
        ),
        applications:application_id (
          id,
          status
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false });
    
    if (status) {
      query = query.eq('status', status);
    }
    
    if (region) {
      query = query.eq('jobs.location', region);
    }

    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }
    
    query = query.range(offset, offset + limit - 1);
    
    const { data: placements, error, count } = await query;
    
    if (error) throw error;
    
    return res.json({
      placements: placements || [],
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

