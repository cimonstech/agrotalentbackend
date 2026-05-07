import { Router } from 'express';
import { getSupabaseAdminClient } from '../lib/supabase.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import type { AdminAuthRequest } from '../types/auth.js';
import { queryParamToString } from '../lib/query.js';
import { errorMessage } from '../lib/errors.js'
import { sendDocumentReviewedEmail } from '../services/email-service.js';
import { sendDocumentReviewedSms } from '../services/sms-service.js';
import { fireAndForget } from '../lib/notify.js'

const router = Router();

// GET /api/admin/documents - List documents for verification
router.get('/documents', authenticate, requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const documentType = req.query.document_type;
    const status = req.query.status;
    const search = req.query.search;
    const page = parseInt(queryParamToString(req.query.page) || '1', 10);
    const limit = parseInt(queryParamToString(req.query.limit) || '50', 10);
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('documents')
      .select(`
        *,
        profiles:user_id (
          id,
          full_name,
          email,
          role
        )
      `, { count: 'exact' })
      .order('uploaded_at', { ascending: false });

    if (documentType) {
      query = query.eq('document_type', documentType);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.or(
        `file_name.ilike.%${search}%,profiles.full_name.ilike.%${search}%,profiles.email.ilike.%${search}%`
      );
    }

    query = query.range(offset, offset + limit - 1);

    const { data: documents, error, count } = await query;

    if (error) throw error;

    return res.json({
      documents: documents || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Admin documents fetch error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to fetch documents' });
  }
});

// POST /api/admin/documents/:id/approve - Approve document
router.post('/documents/:id/approve', authenticate, requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { data: document, error } = await supabaseAdmin
      .from('documents')
      .update({
        status: 'approved',
        reviewed_by: (req as AdminAuthRequest).user.id,
        reviewed_at: new Date().toISOString(),
        rejection_reason: null
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    if (document?.user_id) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email, phone, full_name')
        .eq('id', document.user_id)
        .maybeSingle()
      if (profile?.email) {
        fireAndForget(
          () =>
            sendDocumentReviewedEmail(
              profile.email,
              profile.full_name ?? 'User',
              document.document_type,
              document.file_name,
              'approved',
              null
            ),
          'document-reviewed-email',
          {
            event_type: 'document_reviewed',
            channel: 'email',
            recipient_email: profile.email,
            subject: 'Document reviewed',
            message: 'Document reviewed email sent (approved)',
            related_user_id: document.user_id,
            triggered_by: 'admin',
          }
        )
      }
      if (profile?.phone) {
        fireAndForget(
          () =>
            sendDocumentReviewedSms(
              profile.phone,
              profile.full_name ?? 'User',
              document.document_type,
              'approved'
            ),
          'document-reviewed-sms',
          {
            event_type: 'document_reviewed',
            channel: 'sms',
            recipient_phone: profile.phone,
            message: 'Document reviewed SMS sent (approved)',
            related_user_id: document.user_id,
            triggered_by: 'admin',
          }
        )
      }
    }
    return res.json({ document });
  } catch (error) {
    console.error('Admin document approve error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to approve document' });
  }
});

// POST /api/admin/documents/:id/reject - Reject document
router.post('/documents/:id/reject', authenticate, requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { reason } = req.body || {};
    const { data: document, error } = await supabaseAdmin
      .from('documents')
      .update({
        status: 'rejected',
        reviewed_by: (req as AdminAuthRequest).user.id,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason || null
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    if (document?.user_id) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email, phone, full_name')
        .eq('id', document.user_id)
        .maybeSingle()
      if (profile?.email) {
        fireAndForget(
          () =>
            sendDocumentReviewedEmail(
              profile.email,
              profile.full_name ?? 'User',
              document.document_type,
              document.file_name,
              'rejected',
              reason || null
            ),
          'document-reviewed-email',
          {
            event_type: 'document_reviewed',
            channel: 'email',
            recipient_email: profile.email,
            subject: 'Document reviewed',
            message: 'Document reviewed email sent (rejected)',
            related_user_id: document.user_id,
            triggered_by: 'admin',
          }
        )
      }
      if (profile?.phone) {
        fireAndForget(
          () =>
            sendDocumentReviewedSms(
              profile.phone,
              profile.full_name ?? 'User',
              document.document_type,
              'rejected'
            ),
          'document-reviewed-sms',
          {
            event_type: 'document_reviewed',
            channel: 'sms',
            recipient_phone: profile.phone,
            message: 'Document reviewed SMS sent (rejected)',
            related_user_id: document.user_id,
            triggered_by: 'admin',
          }
        )
      }
    }
    return res.json({ document });
  } catch (error) {
    console.error('Admin document reject error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to reject document' });
  }
});

export default router;

