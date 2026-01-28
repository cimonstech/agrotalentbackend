import express from 'express';
import { getSupabaseAdminClient } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET /api/placements - Get placements for authenticated user (farm or graduate)
router.get('/', authenticate, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    
    // Get user profile to determine role
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();
    
    if (profileError || !profile) {
      return res.status(403).json({ error: 'Profile not found' });
    }
    
    const status = req.query.status;
    const page = parseInt(req.query.page || '1');
    const limit = parseInt(req.query.limit || '50');
    const offset = (page - 1) * limit;
    
    let query;
    
    if (profile.role === 'farm') {
      // Farms see placements for their jobs
      query = supabaseAdmin
        .from('placements')
        .select(`
          *,
          jobs:job_id (
            id,
            title,
            location,
            job_type
          ),
          graduate:graduate_id (
            id,
            full_name,
            email,
            phone,
            preferred_region,
            qualification
          ),
          applications:application_id (
            id,
            status
          )
        `, { count: 'exact' })
        .eq('farm_id', req.user.id)
        .order('created_at', { ascending: false });
    } else if (profile.role === 'graduate' || profile.role === 'student' || profile.role === 'skilled') {
      // Graduates/Students/Workers see their own placements
      query = supabaseAdmin
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
            farm_location,
            email,
            phone
          ),
          applications:application_id (
            id,
            status
          )
        `, { count: 'exact' })
        .eq('graduate_id', req.user.id)
        .order('created_at', { ascending: false });
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (status) {
      query = query.eq('status', status);
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
    console.error('[GET /placements] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
