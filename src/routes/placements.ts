import express from 'express';
import { getSupabaseAdminClient } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';
import type { AuthRequest } from '../types/auth.js';
import { queryParamToString } from '../lib/query.js';
import { errorMessage } from '../lib/errors.js';
import { sendPlacementConfirmedEmail } from '../services/email-service.js';
import { sendPlacementConfirmedSms } from '../services/sms-service.js';
import { fireAndForget } from '../lib/notify.js'

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', (req as AuthRequest).user.id)
      .single();

    if (profileError || !profile) {
      return res.status(403).json({ error: 'Profile not found' });
    }

    const status = queryParamToString(req.query.status);
    const page = parseInt(queryParamToString(req.query.page) || '1', 10);
    const limit = parseInt(queryParamToString(req.query.limit) || '50', 10);
    const offset = (page - 1) * limit;

    let query;

    if (profile.role === 'farm') {
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
        .eq('farm_id', (req as AuthRequest).user.id)
        .order('created_at', { ascending: false });
    } else if (profile.role === 'graduate' || profile.role === 'student' || profile.role === 'skilled') {
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
        .eq('graduate_id', (req as AuthRequest).user.id)
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
    return res.status(500).json({ error: errorMessage(error) });
  }
});

export function schedulePlacementConfirmedEmail(placement: {
  graduate_id: string;
  farm_id: string;
  job_id: string;
  start_date?: string | null;
}): void {
  fireAndForget(async () => {
    const admin = getSupabaseAdminClient();
    const [{ data: graduate }, { data: farm }, { data: jobRow }] = await Promise.all([
      admin
        .from('profiles')
        .select('email, phone, full_name')
        .eq('id', placement.graduate_id)
        .single(),
      admin
        .from('profiles')
        .select('farm_name, full_name')
        .eq('id', placement.farm_id)
        .single(),
      admin.from('jobs').select('title').eq('id', placement.job_id).single(),
    ]);
    if (!graduate?.email || !jobRow?.title) return;
    fireAndForget(
      () =>
        sendPlacementConfirmedEmail(
          graduate.email,
          graduate.full_name ?? 'Graduate',
          jobRow.title,
          farm?.farm_name ?? farm?.full_name ?? 'Farm',
          placement.start_date ?? undefined
        ),
      'placement-confirmed-email',
      {
        event_type: 'placement_confirmed',
        channel: 'email',
        recipient_email: graduate.email,
        subject: 'Placement confirmed',
        message: 'Placement confirmation email sent to graduate',
        related_job_id: placement.job_id,
        related_user_id: placement.graduate_id,
        triggered_by: 'admin',
      }
    )
    if (graduate?.phone) {
      fireAndForget(
        () =>
          sendPlacementConfirmedSms(
            graduate.phone,
            graduate.full_name ?? 'Graduate',
            jobRow.title,
            farm?.farm_name ?? farm?.full_name ?? 'Farm'
          ),
        'placement-confirmed-sms',
        {
          event_type: 'placement_confirmed',
          channel: 'sms',
          recipient_phone: graduate.phone,
          message: 'Placement confirmation SMS sent to graduate',
          related_job_id: placement.job_id,
          related_user_id: placement.graduate_id,
          triggered_by: 'admin',
        }
      )
    }
  }, 'placement-confirmed-notifications')
}

export default router;
