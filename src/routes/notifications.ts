import express from 'express';
import { getSupabaseAdminClient, getSupabaseClient } from '../lib/supabase.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import type { AuthRequest } from '../types/auth.js';
import { errorMessage } from '../lib/errors.js';
import { sendVerificationApprovedSms } from '../services/sms-service.js';

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const supabase = (req as AuthRequest).supabase ?? getSupabaseClient();
    const unreadOnly = req.query.unread === 'true';

    let query = supabase
      .from('notifications')
      .select('id, type, title, message, link, read, notice_id, created_at')
      .eq('user_id', (req as AuthRequest).user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (unreadOnly) {
      query = query.eq('read', false);
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.json({ notifications: data || [] });
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

router.patch('/', authenticate, async (req, res) => {
  try {
    const supabase = (req as AuthRequest).supabase ?? getSupabaseClient();
    const { notification_ids, mark_all_read } = req.body;

    if (mark_all_read) {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', (req as AuthRequest).user.id)
        .eq('read', false);

      if (error) throw error;

      return res.json({ message: 'All notifications marked as read' });
    } else if (notification_ids && Array.isArray(notification_ids)) {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .in('id', notification_ids)
        .eq('user_id', (req as AuthRequest).user.id);

      if (error) throw error;

      return res.json({ message: 'Notifications marked as read' });
    } else {
      return res.status(400).json({ error: 'Invalid request' });
    }
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

router.post('/send-sms', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabaseAdminClient()
    const { user_id, type } = req.body as { user_id?: string; type?: string }
    if (!user_id || !type) {
      return res.status(400).json({ error: 'user_id and type are required' })
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, phone')
      .eq('id', user_id)
      .single()
    if (profile?.phone && type === 'verification_approved') {
      void sendVerificationApprovedSms(profile.phone, profile.full_name ?? 'User').catch(console.error)
    }
    return res.json({ success: true })
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) })
  }
})

export default router;
