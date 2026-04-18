import express from 'express';
import { authenticate } from '../middleware/auth.js';
import type { AuthRequest } from '../types/auth.js';
import { errorMessage } from '../lib/errors.js';

const router = express.Router();

router.get('/:id', authenticate, async (req, res) => {
  try {
    const supabase = (req as AuthRequest).supabase;
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
    return res.status(500).json({ error: errorMessage(error) });
  }
});

export default router;
