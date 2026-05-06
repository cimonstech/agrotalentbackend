import crypto from 'crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { Router } from 'express';
import { getSupabaseAdminClient } from '../lib/supabase.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { uploadSingleImage } from '../middleware/upload.js';
import {
  sendNoticePostedEmail,
  sendNotificationEmail,
} from '../services/email-service.js';
import type { AdminAuthRequest } from '../types/auth.js';
import { queryParamToString } from '../lib/query.js';
import { errorMessage } from '../lib/errors.js'
import { validate } from '../lib/validate.js'
import {
  createNoticeSchema,
} from '../lib/schemas.js'
import { fireAndForget } from '../lib/notify.js'

const router = Router();

interface CreateNoticePayload {
  title: string;
  body_html: string;
  link: string | null;
  audience: string;
  created_by: string;
  attachments?: unknown;
}

interface ProfileTargetRow {
  id: string;
  email: string | null;
  full_name: string | null;
  farm_name: string | null;
  phone: string | null;
  role: string;
}

function firstToken(displayName: string): string {
  const t = displayName.trim().split(/\s+/)[0];
  return t || '';
}

/** Replace {{name}}, {{first_name}}, {{full_name}}, {{farm_name}}, {{role}}, {{email}} in bulk messages. */
function personalizeCommunicationMessage(template: string, row: ProfileTargetRow): string {
  const full = row.full_name?.trim() ?? '';
  const farm = row.farm_name?.trim() ?? '';
  const display = full || farm || 'there';
  const first = firstToken(full || farm) || 'there';
  const vars: Record<string, string> = {
    name: display,
    first_name: first,
    full_name: full,
    farm_name: farm,
    role: row.role ?? '',
    email: row.email?.trim() ?? '',
  };
  let out = template;
  for (const [key, val] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
    out = out.replace(re, val);
  }
  return out;
}

function greetingNameForEmail(row: ProfileTargetRow): string {
  return row.full_name?.trim() || row.farm_name?.trim() || '';
}

// GET /api/admin/communications/logs - View sent message logs
router.get('/communications/logs', authenticate, requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const limit = parseInt(queryParamToString(req.query.limit) || '50', 10);

    const { data: logs, error } = await supabaseAdmin
      .from('communication_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    // If table isn't created yet, return empty
    if (error) {
      if (error.message?.includes('does not exist')) {
        return res.json({ logs: [] });
      }
      throw error;
    }

    return res.json({ logs: logs || [] });
  } catch (error) {
    console.error('Communications logs error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to fetch logs' });
  }
});

function normalizeCommunicationRecipientsKey(raw: unknown): string {
  const k = String(raw ?? '')
    .toLowerCase()
    .trim();
  const map: Record<string, string> = {
    all: 'all',
    farm: 'farms',
    farms: 'farms',
    graduate: 'graduates',
    graduates: 'graduates',
    student: 'students',
    students: 'students',
    skilled: 'skilled',
    single: 'single',
    custom: 'custom',
  };
  return map[k] || k;
}

// POST /api/admin/communications/send - Send bulk or single message
router.post('/communications/send', authenticate, requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const {
      type,
      recipients: recipientsRaw,
      subject,
      message,
      userId,
      email,
      customRecipients: customRecipientsRaw,
      customUserIds: customUserIdsRaw,
    } = req.body || {};

    if (!type || recipientsRaw == null || !message) {
      return res.status(400).json({ error: 'type, recipients, and message are required' });
    }

    if (type === 'email' && !subject) {
      return res.status(400).json({ error: 'subject is required for email' });
    }

    const recipientsKey = normalizeCommunicationRecipientsKey(recipientsRaw);

    // Resolve recipients
    let targets: ProfileTargetRow[] = [];

    if (recipientsKey === 'single') {
      if (userId) {
        const { data } = await supabaseAdmin
          .from('profiles')
          .select('id, email, full_name, farm_name, phone, role')
          .eq('id', userId)
          .maybeSingle();
        if (data) targets = [data];
      } else if (email) {
        const { data } = await supabaseAdmin
          .from('profiles')
          .select('id, email, full_name, farm_name, phone, role')
          .eq('email', email)
          .maybeSingle();
        if (data) targets = [data];
      } else {
        return res.status(400).json({ error: 'userId or email is required for single recipient' });
      }
    } else if (recipientsKey === 'custom') {
      const idList = Array.isArray(customUserIdsRaw)
        ? (customUserIdsRaw as unknown[])
            .map((id) => String(id ?? '').trim())
            .filter(Boolean)
        : [];
      if (idList.length > 0) {
        const chunkSize = 200;
        const seen = new Set<string>();
        for (let i = 0; i < idList.length; i += chunkSize) {
          const chunk = idList.slice(i, i + chunkSize);
          const { data: rows } = await supabaseAdmin
            .from('profiles')
            .select('id, email, full_name, farm_name, phone, role')
            .in('id', chunk)
            .neq('role', 'admin');
          for (const row of rows || []) {
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            targets.push(row as ProfileTargetRow);
          }
        }
        if (targets.length === 0) {
          return res.status(400).json({ error: 'No matching profiles for custom user ids' });
        }
      } else {
        const parts = String(customRecipientsRaw ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (parts.length === 0) {
          return res.status(400).json({
            error: 'Provide customUserIds or comma-separated customRecipients for custom audience',
          });
        }
        for (const em of parts) {
          const { data: row } = await supabaseAdmin
            .from('profiles')
            .select('id, email, full_name, farm_name, phone, role')
            .eq('email', em)
            .maybeSingle();
          if (row) {
            targets.push(row);
          } else {
            targets.push({
              id: crypto.randomUUID(),
              email: em,
              full_name: null,
              farm_name: null,
              phone: null,
              role: 'unknown',
            });
          }
        }
      }
    } else {
      let query = supabaseAdmin
        .from('profiles')
        .select('id, email, full_name, farm_name, phone, role')
        .limit(2000);

      if (recipientsKey === 'farms') query = query.eq('role', 'farm');
      if (recipientsKey === 'graduates') query = query.eq('role', 'graduate');
      if (recipientsKey === 'students') query = query.eq('role', 'student');
      if (recipientsKey === 'skilled') query = query.eq('role', 'skilled');
      if (
        recipientsKey !== 'all' &&
        recipientsKey !== 'farms' &&
        recipientsKey !== 'graduates' &&
        recipientsKey !== 'students' &&
        recipientsKey !== 'skilled'
      ) {
        return res.status(400).json({
          error:
            'Invalid recipients. Use all, farm(s), graduate(s), student(s), skilled, single, or custom.',
        });
      }

      const { data: profileRows } = await query;
      const profiles = profileRows || [];

      const authEmailById: Record<string, string | null> = {};
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
        const users = listData?.users || [];
        users.forEach((u: User) => {
          authEmailById[u.id] = u.email ?? null;
        });
        hasMore = users.length === 1000;
        page += 1;
      }
      targets = profiles.map((p) => ({
        ...p,
        email: p.email && p.email.trim() ? p.email.trim() : authEmailById[p.id] || null,
      }));
    }

    const recipientCount = targets.length;

    const logPayload = {
      type,
      recipients: recipientsKey,
      subject: subject || null,
      message,
      recipient_count: recipientCount,
      success_count: 0,
      failure_count: 0,
      status: 'sending',
      created_by: (req as AdminAuthRequest).user.id,
    };

    let logId: string | null = null;
    const { data: logRow } = await supabaseAdmin
      .from('communication_logs')
      .insert(logPayload)
      .select()
      .maybeSingle();
    logId = logRow?.id || null;

    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;
    const failures: { email?: string; phone?: string; error: string }[] = [];

    if (type === 'email') {
      const { sendNotificationEmail } = await import('../services/email-service.js');

      for (const t of targets) {
        if (!t.email || !String(t.email).trim()) {
          skippedCount += 1;
          continue;
        }
        const body = personalizeCommunicationMessage(message, t);
        const subj = subject ? personalizeCommunicationMessage(subject, t) : subject;
        const result = await sendNotificationEmail(
          t.email,
          subj,
          body,
          greetingNameForEmail(t),
          { role: t.role }
        );
        if (result?.success) {
          successCount += 1;
        } else {
          failureCount += 1;
          failures.push({ email: t.email, error: result?.error || 'Failed to send' });
        }
      }
    } else if (type === 'sms') {
      res.json({
        message: 'SMS sending started. Check message logs for delivery status.',
        logId,
        recipientCount,
        successCount: 0,
        failureCount: 0,
        skippedCount: 0,
      });

      fireAndForget(async () => {
        const { sendRawSms } = await import('../services/sms-service.js')
        let bgSuccess = 0
        let bgFailure = 0
        let bgSkipped = 0
        const bgFailures: { phone: string; error: string }[] = []

        for (const t of targets) {
          if (!t.phone || !String(t.phone).trim()) {
            bgSkipped += 1
            continue
          }
          const smsBody = personalizeCommunicationMessage(message, t)
          const result = await sendRawSms(t.phone, smsBody, 'Admin Communications')
          if (result.success) {
            bgSuccess += 1
          } else {
            bgFailure += 1
            bgFailures.push({ phone: t.phone, error: result.error ?? 'failed' })
          }

          await new Promise((resolve) => setTimeout(resolve, 200))
        }

        const finalStatus = bgSuccess === 0 ? 'failed' : 'sent'
        if (logId) {
          await supabaseAdmin
            .from('communication_logs')
            .update({
              success_count: bgSuccess,
              failure_count: bgFailure,
              status: finalStatus,
              error_details: bgFailures.length ? bgFailures : null,
            })
            .eq('id', logId)
        }

        console.log(
          '[SMS Bulk] Done:',
          bgSuccess,
          'sent,',
          bgFailure,
          'failed,',
          bgSkipped,
          'skipped'
        )
      }, 'admin-communications-sms-bulk')

      return;
    } else {
      return res.status(400).json({ error: 'Invalid type. Use email or sms.' });
    }

    const finalStatus = successCount === 0 ? 'failed' : 'sent';

    if (logId) {
      await supabaseAdmin
        .from('communication_logs')
        .update({
          success_count: successCount,
          failure_count: failureCount,
          status: finalStatus,
          error_details: failures.length ? failures : null,
        })
        .eq('id', logId);
    }

    const messageText =
      skippedCount > 0
        ? `Email sent to ${successCount}, ${failureCount} failed, ${skippedCount} skipped (no email address).`
        : `Email sent to ${successCount}, ${failureCount} failed.`;

    return res.json({
      message: messageText,
      logId,
      recipientCount,
      successCount,
      failureCount,
      skippedCount,
    });
  } catch (error) {
    console.error('Communications send error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to send message' });
  }
});

// GET /api/admin/notices - List all notices (admin)
router.get('/notices', authenticate, requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from('notices')
      .select('id, title, body_html, link, audience, attachments, created_by, created_at')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      if (error.message?.includes('does not exist')) return res.json({ notices: [] });
      throw error;
    }
    return res.json({ notices: data || [] });
  } catch (error) {
    console.error('Admin notices list error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to fetch notices' });
  }
});

// POST /api/admin/notices/upload-image - Upload a picture for a notice (admin)
router.post('/notices/upload-image', authenticate, requireAdmin, (req, res, next) => {
  uploadSingleImage('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Invalid file' });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file || !req.file.path) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const { generateR2Key, uploadToR2 } = await import('../services/r2-service.js');
    const safeName = (req.file.originalname || 'image').replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = generateR2Key('notices', safeName);
    const publicUrl = await uploadToR2(key, req.file.path, req.file.mimetype);
    return res.status(201).json({ url: publicUrl, file_name: req.file.originalname || 'image' });
  } catch (error) {
    console.error('Notice image upload error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Upload failed' });
  }
});

async function createNoticeAndNotify(
  supabaseAdmin: SupabaseClient,
  { title, body_html, link, audience, created_by, attachments }: CreateNoticePayload
) {
  const attachmentsList = Array.isArray(attachments) ? attachments : [];
  const { data: notice, error: insertError } = await supabaseAdmin
    .from('notices')
    .insert({
      title,
      body_html,
      link: link || null,
      audience,
      created_by,
      attachments: attachmentsList.length ? attachmentsList : []
    })
    .select()
    .single();

  if (insertError) throw insertError;

  let roleFilter = supabaseAdmin
    .from('profiles')
    .select('id, role, full_name, farm_name, email, phone')
    .neq('role', 'admin');
  if (audience !== 'all') roleFilter = roleFilter.eq('role', audience);
  const { data: profiles } = await roleFilter.limit(5000);
  const profilesList = (profiles || []) as ProfileTargetRow[];

  const noticeDetailPath = (role: string) => `/dashboard/${role === 'student' ? 'graduate' : role}/notices/${notice.id}`;
  const noticeLink = (link && link.trim()) ? link.trim() : null;
  const notificationRows = profilesList.map((p) => ({
    user_id: p.id,
    type: 'notice',
    title,
    message: title,
    link: noticeLink || noticeDetailPath(p.role),
    read: false,
    notice_id: notice.id
  }));

  if (notificationRows.length) {
    const { error: notifError } = await supabaseAdmin.from('notifications').insert(notificationRows);
    if (notifError) console.warn('Notice notifications insert failed (ignored):', notifError.message);
  }

  return { notice, notificationCount: profilesList.length, profilesList };
}

// POST /api/admin/notices - Create notice and notify all non-admin users in audience
router.post('/notices', authenticate, requireAdmin, validate(createNoticeSchema), async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { title, body_html, link, audience, attachments } = req.body || {};

    if (!title || !body_html || !audience) {
      return res.status(400).json({ error: 'title, body_html, and audience are required' });
    }
    const allowedAudience = new Set(['all', 'graduate', 'farm', 'student']);
    if (!allowedAudience.has(audience)) {
      return res.status(400).json({ error: 'audience must be one of: all, graduate, farm, student' });
    }

    const attachmentsList = Array.isArray(attachments)
      ? attachments.filter((a) => a && a.url && typeof a.url === 'string')
      : [];

    const { notice, notificationCount, profilesList: targetProfiles } = await createNoticeAndNotify(supabaseAdmin, {
      title,
      body_html,
      link,
      audience,
      created_by: (req as AdminAuthRequest).user.id,
      attachments: attachmentsList
    });

    const noticeEmailTargets = targetProfiles.slice(0, 100)
    const frontendBase = String(process.env.FRONTEND_URL ?? '').replace(/\/+$/, '')
    for (const p of noticeEmailTargets) {
      if (!p.email) continue
      const roleSegment = p.role === 'skilled' ? 'skilled' : p.role === 'student' ? 'student' : p.role === 'farm' ? 'farm' : 'graduate'
      const noticeHref = `${frontendBase}/dashboard/${roleSegment}/notices/${notice.id}`
      fireAndForget(
        () =>
          sendNoticePostedEmail(
            p.email ?? '',
            p.full_name || 'User',
            notice.title,
            notice.audience,
            noticeHref
          ),
        'notice-posted-email'
      )
    }

    // Send notice by email to the same audience (merge auth emails like communications)
    let emailSent = 0;
    let emailSkipped = 0;
    const authEmailById: Record<string, string | null> = {};
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      const users = listData?.users || [];
      users.forEach((u: User) => { authEmailById[u.id] = u.email ?? null; });
      hasMore = users.length === 1000;
      page += 1;
    }
    const plainBody = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const notificationsUrl = (role: string) => `/dashboard/${role}/notifications`;
    for (const p of targetProfiles) {
      const email = (p.email && String(p.email).trim()) ? p.email.trim() : authEmailById[p.id];
      if (!email) {
        emailSkipped += 1;
        continue;
      }
      const result = await sendNotificationEmail(
        email,
        title,
        plainBody(body_html) || title,
        p.full_name || '',
        { ctaUrl: notificationsUrl(p.role), ctaText: 'View in Notifications', role: p.role }
      );
      if (result?.success) emailSent += 1;
    }

    return res.status(201).json({
      notice,
      notificationCount,
      emailSent,
      emailSkipped,
      message: notificationCount
        ? `Notice created. ${notificationCount} user(s) notified in-app; ${emailSent} email(s) sent${emailSkipped ? `, ${emailSkipped} skipped (no email).` : '.'}`
        : 'Notice created; no users in audience.'
    });
  } catch (error) {
    console.error('Admin notices create error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to create notice' });
  }
});

export default router;

