import { Router } from 'express';
import { getSupabaseAdminClient } from '../lib/supabase.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import type { AdminAuthRequest } from '../types/auth.js';
import { errorMessage } from '../lib/errors.js'

const router = Router();

const DEFAULT_SETTINGS = {
  recruitment_fee: 200,
  salary_benchmark_min: 500,
  salary_benchmark_max: 2000,
  email_notifications_enabled: true,
  sms_notifications_enabled: false
};

// GET /api/admin/settings
router.get('/settings', authenticate, requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from('system_settings')
      .select('value')
      .eq('key', 'global')
      .maybeSingle();

    if (error) {
      if (error.message?.includes('does not exist')) {
        return res.json({ settings: DEFAULT_SETTINGS });
      }
      throw error;
    }

    return res.json({ settings: { ...DEFAULT_SETTINGS, ...(data?.value || {}) } });
  } catch (error) {
    console.error('Admin settings GET error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to fetch settings' });
  }
});

// PUT /api/admin/settings
router.put('/settings', authenticate, requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const incoming = req.body || {};

    const merged = { ...DEFAULT_SETTINGS, ...incoming };

    const { data, error } = await supabaseAdmin
      .from('system_settings')
      .upsert(
        {
          key: 'global',
          value: merged,
          updated_by: (req as AdminAuthRequest).user.id,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'key' }
      )
      .select()
      .maybeSingle();

    if (error) throw error;

    return res.json({ settings: data?.value || merged, message: 'Settings saved' });
  } catch (error) {
    console.error('Admin settings PUT error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to save settings' });
  }
});

export default router;

