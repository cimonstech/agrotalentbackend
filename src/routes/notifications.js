import express from 'express';
import { getSupabaseClient } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET /api/notifications - Get user's notifications
router.get('/', authenticate, async (req, res) => {
  try {
    const supabase = req.supabase || getSupabaseClient();
    const unreadOnly = req.query.unread === 'true';
    
    let query = supabase
      .from('notifications')
      .select('id, type, title, message, link, read, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (unreadOnly) {
      query = query.eq('read', false);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    return res.json({ notifications: data || [] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// PATCH /api/notifications - Mark notifications as read
router.patch('/', authenticate, async (req, res) => {
  try {
    const supabase = req.supabase || getSupabaseClient();
    const { notification_ids, mark_all_read } = req.body;
    
    if (mark_all_read) {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', req.user.id)
        .eq('read', false);
      
      if (error) throw error;
      
      return res.json({ message: 'All notifications marked as read' });
    } else if (notification_ids && Array.isArray(notification_ids)) {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .in('id', notification_ids)
        .eq('user_id', req.user.id);
      
      if (error) throw error;
      
      return res.json({ message: 'Notifications marked as read' });
    } else {
      return res.status(400).json({ error: 'Invalid request' });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
