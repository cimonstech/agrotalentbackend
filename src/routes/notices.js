import express from 'express';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET /api/notices/:id - Single notice (RLS: user can only see if audience matches their role)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const supabase = req.supabase;
    const { data, error } = await supabase
      .from('notices')
      .select('id, title, body_html, link, audience, attachments, created_at')
      .eq('id', req.params.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Notice not found' });
      throw error;
    }
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
