import express from 'express';
import { getSupabaseAdminClient, getSupabaseClient } from '../lib/supabase.js';
import { authenticate, requireAuth } from '../middleware/auth.js';
import type { AuthRequest } from '../types/auth.js';
import { errorMessage } from '../lib/errors.js';
import { sendVerificationApprovedSms, sendApplicationStatusSms } from '../services/sms-service.js';

const router = express.Router();

// --- per-user notification cache ---
type NotifCacheEntry = { data: unknown; expiresAt: number }
const notifCache = new Map<string, NotifCacheEntry>()
const NOTIF_TTL_MS = 20_000 // 20 seconds — dashboard polls every 15s, one free hit then cache

function notifCacheGet(key: string): unknown | null {
  const e = notifCache.get(key)
  if (!e) return null
  if (Date.now() > e.expiresAt) { notifCache.delete(key); return null }
  return e.data
}
function notifCacheSet(key: string, data: unknown) {
  notifCache.set(key, { data, expiresAt: Date.now() + NOTIF_TTL_MS })
}
export function invalidateNotifCache(userId: string) {
  // Delete both full and unread-only variants for this user
  notifCache.delete(`${userId}:all`)
  notifCache.delete(`${userId}:unread`)
}
// -----------------------------------

router.get('/', authenticate, async (req, res) => {
  try {
    const uid = (req as AuthRequest).user.id;
    const unreadOnly = req.query.unread === 'true';
    const cacheKey = `${uid}:${unreadOnly ? 'unread' : 'all'}`;

    const cached = notifCacheGet(cacheKey);
    if (cached) return res.json({ notifications: cached });

    const supabase = (req as AuthRequest).supabase ?? getSupabaseClient();

    let query = supabase
      .from('notifications')
      .select('id, type, title, message, link, read, notice_id, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(20);

    if (unreadOnly) {
      query = query.eq('read', false);
    }

    const { data, error } = await query;

    if (error) throw error;

    const notifications = data || [];
    notifCacheSet(cacheKey, notifications);
    return res.json({ notifications });
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

router.patch('/', authenticate, async (req, res) => {
  try {
    const supabase = (req as AuthRequest).supabase ?? getSupabaseClient();
    const { notification_ids, mark_all_read } = req.body;

    const uid = (req as AuthRequest).user.id;

    if (mark_all_read) {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', uid)
        .eq('read', false);

      if (error) throw error;

      invalidateNotifCache(uid);
      return res.json({ message: 'All notifications marked as read' });
    } else if (notification_ids && Array.isArray(notification_ids)) {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .in('id', notification_ids)
        .eq('user_id', uid);

      if (error) throw error;

      invalidateNotifCache(uid);
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
        void sendVerificationApprovedSms(profile.phone, profile.full_name ?? 'User').catch(console.error)
      } else if (type === 'application_status' && status && job_title) {
        void sendApplicationStatusSms(profile.phone, profile.full_name ?? 'Applicant', job_title, status).catch(console.error)
      }
    }
    return res.json({ success: true })
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) })
  }
})

export default router;
