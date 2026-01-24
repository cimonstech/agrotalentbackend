import express from 'express';
import { getSupabaseAdminClient } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET /api/training - Get "my trainings" (assigned sessions + attendance status)
router.get('/', authenticate, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const upcoming = req.query.upcoming === 'true';
    const category = req.query.category;
    const status = req.query.status;

    // Find assignments for this user
    const { data: assignments, error: assignmentsError } = await supabaseAdmin
      .from('training_participants')
      .select('session_id, attendance_status, checked_in_at, notes')
      .eq('participant_id', req.user.id);

    // If table doesn't exist yet, return empty
    if (assignmentsError) {
      if (assignmentsError.message?.includes('does not exist')) {
        return res.json({ sessions: [] });
      }
      throw assignmentsError;
    }

    const sessionIds = (assignments || []).map(a => a.session_id);
    if (sessionIds.length === 0) {
      return res.json({ sessions: [] });
    }

    let query = supabaseAdmin
      .from('training_sessions')
      .select('*')
      .in('id', sessionIds)
      .order('scheduled_at', { ascending: true });

    if (upcoming) query = query.gte('scheduled_at', new Date().toISOString());
    if (category) query = query.eq('category', category);
    if (status) query = query.eq('status', status);

    const { data: sessions, error: sessionsError } = await query;
    if (sessionsError) throw sessionsError;

    const assignmentMap = new Map((assignments || []).map(a => [a.session_id, a]));
    const enriched = (sessions || []).map(s => ({
      ...s,
      my_attendance_status: assignmentMap.get(s.id)?.attendance_status || null,
      my_checked_in_at: assignmentMap.get(s.id)?.checked_in_at || null,
      my_notes: assignmentMap.get(s.id)?.notes || null
    }));

    return res.json({ sessions: enriched });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// NOTE:
// Admin creation/assignment/attendance endpoints live under /api/admin/trainings
// (to keep "control + proof" admin-owned and consistent with RLS).

export default router;
