import express from 'express';
import { getSupabaseAdminClient, getSupabaseClient } from '../lib/supabase.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import type { AuthRequest } from '../types/auth.js';
import { errorMessage } from '../lib/errors.js';
import { sendVerificationApprovedSms, sendApplicationStatusSms } from '../services/sms-service.js';
import { cacheDel, cacheGet, cacheSet } from '../lib/redis.js'
import { fireAndForget } from '../lib/notify.js'

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const userId = (req as AuthRequest).user.id;
    const unreadOnly = req.query.unread === 'true';
    const cacheKey = `notifications:${userId}:${unreadOnly ? 'unread' : 'all'}`
    const cached = await cacheGet<{ notifications: unknown }>(cacheKey)
    if (cached) return res.json(cached)

    const supabase = (req as AuthRequest).supabase ?? getSupabaseClient();

    let query = supabase
      .from('notifications')
      .select('id, type, title, message, link, read, notice_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (unreadOnly) {
      query = query.eq('read', false);
    }

    const { data, error } = await query;

    if (error) throw error;

    const notifications = data || [];
    const responsePayload = { notifications }
    await cacheSet(cacheKey, responsePayload, 30)
    return res.json(responsePayload)
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

router.patch('/', authenticate, async (req, res) => {
  try {
    const supabase = (req as AuthRequest).supabase ?? getSupabaseClient();
    const { notification_ids, mark_all_read } = req.body;

    const userId = (req as AuthRequest).user.id;

    if (mark_all_read) {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', userId)
        .eq('read', false);

      if (error) throw error;

      await cacheDel(`notifications:${userId}:all`)
      await cacheDel(`notifications:${userId}:unread`)
      return res.json({ message: 'All notifications marked as read' });
    } else if (notification_ids && Array.isArray(notification_ids)) {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .in('id', notification_ids)
        .eq('user_id', userId);

      if (error) throw error;

      await cacheDel(`notifications:${userId}:all`)
      await cacheDel(`notifications:${userId}:unread`)
      return res.json({ message: 'Notifications marked as read' });
    } else {
      return res.status(400).json({ error: 'Invalid request' });
    }
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

router.post('/send-sms', requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabaseAdminClient()
    const { user_id, type, job_title, status } = req.body as { user_id?: string; type?: string; job_title?: string; status?: string }
    if (!user_id || !type) {
      return res.status(400).json({ error: 'user_id and type are required' })
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, phone')
      .eq('id', user_id)
      .single()
    if (profile?.phone) {
      if (type === 'verification_approved') {
        fireAndForget(
          () => sendVerificationApprovedSms(profile.phone, profile.full_name ?? 'User'),
          'verification-approved-sms'
        )
      } else if (type === 'application_status' && status && job_title) {
        fireAndForget(
          () =>
            sendApplicationStatusSms(
              profile.phone,
              profile.full_name ?? 'Applicant',
              job_title,
              status
            ),
          'application-status-sms'
        )
      }
    }
    return res.json({ success: true })
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) })
  }
})

export default router;
