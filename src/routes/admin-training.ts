import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../lib/supabase.js';
import { requireAdmin } from '../middleware/auth.js';
import type { AdminAuthRequest } from '../types/auth.js';
import { queryParamToString } from '../lib/query.js';
import { errorMessage } from '../lib/errors.js'
import { validate } from '../lib/validate.js'
import { createTrainingSchema } from '../lib/schemas.js'
import { sendTrainingScheduledEmail } from '../services/email-service.js';
import { sendTrainingScheduledSms } from '../services/sms-service.js';
import { sendNotificationEmail } from '../services/email-service.js';
import { fireAndForget } from '../lib/notify.js'

const router = Router();

interface ProfileTargetRow {
  id: string;
  email: string | null;
  full_name: string | null;
  farm_name: string | null;
  phone: string | null;
  role: string;
}

interface CreateNoticePayload {
  title: string;
  body_html: string;
  link: string | null;
  audience: string;
  created_by: string;
  attachments?: unknown;
}

interface AssignTargetRow {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: string;
  preferred_region?: string | null;
  farm_location?: string | null;
}

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

// GET /api/admin/trainings - list sessions
router.get('/trainings', requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabaseAdminClient();
    const category = req.query.category;
    const region = req.query.region;
    const status = req.query.status;
    const upcoming = req.query.upcoming === 'true';
    const startDate = req.query.start_date;
    const endDate = req.query.end_date;
    const page = parseInt(queryParamToString(req.query.page) || '1', 10);
    const limit = parseInt(queryParamToString(req.query.limit) || '50', 10);
    const offset = (page - 1) * limit;

    let query = supabase
      .from('training_sessions')
      .select('*', { count: 'exact' })
      .order('scheduled_at', { ascending: false });

    if (category) query = query.eq('category', category);
    if (region) query = query.eq('region', region);
    if (status) query = query.eq('status', status);
    if (upcoming) query = query.gte('scheduled_at', new Date().toISOString());
    if (startDate) query = query.gte('scheduled_at', startDate);
    if (endDate) query = query.lte('scheduled_at', endDate);

    query = query.range(offset, offset + limit - 1);

    const { data: trainings, error, count } = await query;
    if (error) throw error;

    return res.json({
      trainings: trainings || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Admin trainings fetch error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to fetch trainings' });
  }
});

// POST /api/admin/trainings - create session
router.post('/trainings', requireAdmin, validate(createTrainingSchema), async (req, res) => {
  try {
    const supabase = getSupabaseAdminClient();
    const {
      title,
      description,
      session_type,
      category,
      region,
      trainer_name,
      trainer_type,
      scheduled_at,
      duration_minutes,
      zoom_link,
      attendance_method
    } = req.body || {};

    if (!title || !category || !region || !scheduled_at) {
      return res.status(400).json({ error: 'title, category, region, and scheduled_at are required' });
    }

    // training_sessions.session_type is NOT NULL (legacy constraint)
    // Allowed values come from the DB check constraint.
    const allowedSessionTypes = new Set(['orientation', 'pre_employment', 'quarterly', 'custom']);
    const resolvedSessionType = session_type || 'pre_employment';
    if (!allowedSessionTypes.has(resolvedSessionType)) {
      return res.status(400).json({
        error: `Invalid session_type. Allowed: ${Array.from(allowedSessionTypes).join(', ')}`
      });
    }

    const { data: session, error } = await supabase
      .from('training_sessions')
      .insert({
        title,
        description: description || null,
        session_type: resolvedSessionType,
        category,
        region,
        trainer_name: trainer_name || null,
        trainer_type: trainer_type || 'admin',
        scheduled_at: new Date(scheduled_at).toISOString(),
        duration_minutes: duration_minutes || 60,
        zoom_link: zoom_link || null,
        attendance_method: attendance_method || 'manual',
        status: 'scheduled',
        created_by: (req as AdminAuthRequest).user.id
      })
      .select()
      .single();

    if (error) throw error;

    const { data: participants } = await supabase
      .from('training_participants')
      .select('participant_id')
      .eq('session_id', session.id)

    for (const row of participants || []) {
      const { data: participantProfile } = await supabase
        .from('profiles')
        .select('email, phone, full_name')
        .eq('id', row.participant_id)
        .maybeSingle()

      if (!participantProfile?.email) continue
      fireAndForget(
        () =>
          sendTrainingScheduledEmail(
            participantProfile.email,
            participantProfile.full_name ?? 'Participant',
            session.title,
            session.scheduled_at,
            session.zoom_link,
            session.trainer_name
          ),
        'training-scheduled-email'
      )
      if (participantProfile.phone) {
        fireAndForget(
          () =>
            sendTrainingScheduledSms(
              participantProfile.phone,
              participantProfile.full_name ?? 'Participant',
              session.title,
              new Date(session.scheduled_at).toLocaleDateString('en-GH', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            ),
          'training-scheduled-sms'
        )
      }
    }

    // Create a notice so it appears in user notifications; link is left unset so each notification gets /dashboard/{role}/notices/{id}
    try {
      const noticeTitle = `New training: ${title}`;
      const noticeBody = `<p>${noticeTitle}</p><p>${description || ''}</p><p>Region: ${region} • Category: ${category}</p>`;
      await createNoticeAndNotify(supabase, {
        title: noticeTitle,
        body_html: noticeBody,
        link: null,
        audience: 'all',
        created_by: (req as AdminAuthRequest).user.id
      });
    } catch (e) {
      console.warn('Training notice creation failed (ignored):', errorMessage(e));
    }

    return res.status(201).json({ training: session });
  } catch (error) {
    console.error('Admin trainings create error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to create training' });
  }
});

// GET /api/admin/trainings/:id - session + participants
router.get('/trainings/:id', requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabaseAdminClient();

    const { data: training, error: trainingError } = await supabase
      .from('training_sessions')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (trainingError) throw trainingError;

    const { data: participants, error: participantsError } = await supabase
      .from('training_participants')
      .select(`
        *,
        profile:participant_id (
          id,
          email,
          full_name,
          phone,
          role,
          preferred_region,
          farm_location
        )
      `)
      .eq('session_id', req.params.id)
      .order('assigned_at', { ascending: false });

    // If table not created yet, return empty
    if (participantsError) {
      if (participantsError.message?.includes('does not exist')) {
        return res.json({ training, participants: [] });
      }
      throw participantsError;
    }

    return res.json({ training, participants: participants || [] });
  } catch (error) {
    console.error('Admin training detail error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to fetch training' });
  }
});

// POST /api/admin/trainings/:id/assign - assign participants (selected IDs OR by filters)
router.post('/trainings/:id/assign', requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabaseAdminClient();
    const { userIds, role, region, search, notify_email, notify_sms } = req.body || {};

    // Resolve targets
    let targets: AssignTargetRow[] = [];
    if (Array.isArray(userIds) && userIds.length) {
      const { data, error } = await supabase
        .from('profiles')
        .select('id,email,full_name,phone,role,preferred_region,farm_location')
        .in('id', userIds);
      if (error) throw error;
      targets = data || [];
    } else {
      let q = supabase
        .from('profiles')
        .select('id,email,full_name,phone,role,preferred_region,farm_location')
        .neq('role', 'admin');
      if (role) q = q.eq('role', role);
      if (region) {
        // farms store region in farm_location; graduates/students in preferred_region
        q = q.or(`preferred_region.eq.${region},farm_location.eq.${region}`);
      }
      if (search) {
        q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
      }
      const { data, error } = await q.limit(500);
      if (error) throw error;
      targets = data || [];
    }

    if (!targets.length) {
      return res.json({ assigned: 0, targets: [] });
    }

    // Create assignment rows (ignore duplicates via upsert on unique constraint)
    const rows = targets.map(t => ({
      session_id: req.params.id,
      participant_id: t.id,
      assigned_by: (req as AdminAuthRequest).user.id
    }));

    const { data: inserted, error: insertError } = await supabase
      .from('training_participants')
      .upsert(rows, { onConflict: 'session_id,participant_id' })
      .select();

    if (insertError) {
      if (insertError.message?.includes('does not exist')) {
        return res.status(500).json({ error: 'training_participants table not created yet. Run migration 011_training_management.sql' });
      }
      throw insertError;
    }

    // Create in-app notifications
    try {
      const trainingLinkForRole = (role: string) => {
        switch (role) {
          case 'admin':
            return '/dashboard/admin/training';
          case 'farm':
            return '/dashboard/farm/training';
          case 'student':
            return '/dashboard/student/training';
          case 'graduate':
            return '/dashboard/graduate/training';
          case 'worker':
            // Worker dashboard not implemented yet; use applicant dashboard for now.
            return '/dashboard/graduate/training';
          default:
            return '/signin';
        }
      };

      const { error: notifError } = await supabase
        .from('notifications')
        .insert(
          targets.map(t => ({
            user_id: t.id,
            type: 'training_scheduled',
            title: 'Training Assigned',
            message: 'A training session has been assigned to you. Please check your dashboard for details.',
            link: trainingLinkForRole(t.role)
          }))
        );
      // Notifications are best-effort; don't fail assignment if this errors (e.g. RLS)
      if (notifError) {
        console.warn('Training notifications insert failed (ignored):', notifError.message);
      }
    } catch (e) {
      // ignore
    }

    // Optional: send email + log "sms" intent via communication_logs through communications system
    if (notify_email) {
      // Load training info once
      const { data: training } = await supabase
        .from('training_sessions')
        .select('title,scheduled_at,zoom_link,region')
        .eq('id', req.params.id)
        .maybeSingle();

      for (const t of targets) {
          const trainingLinkForRole = (role: string) => {
            switch (role) {
              case 'admin':
                return '/dashboard/admin/training';
              case 'farm':
                return '/dashboard/farm/training';
              case 'student':
                return '/dashboard/student/training';
              case 'graduate':
                return '/dashboard/graduate/training';
              case 'worker':
                return '/dashboard/graduate/training';
              default:
                return '/signin';
            }
          };

          fireAndForget(
            () =>
              sendNotificationEmail(
                t.email || '',
                'Training Assigned - AgroTalent Hub',
                `You have been assigned to a training session: <b>${training?.title || 'Training Session'}</b><br/><br/>
            <b>Date/Time:</b> ${training?.scheduled_at ? new Date(training.scheduled_at).toLocaleString() : ''}<br/>
            <b>Region:</b> ${training?.region || ''}<br/>
            <b>Zoom Link:</b> ${training?.zoom_link || 'See dashboard'}<br/><br/>
            Please log in to your dashboard for full details.`,
                t.full_name || '',
                { role: t.role, ctaUrl: trainingLinkForRole(t.role), ctaText: 'View Training' }
              ),
            'training-assigned-email'
          )
      }
    }

    if (notify_sms) {
      try {
        const { data: smsLog, error: smsLogError } = await supabase
          .from('communication_logs')
          .insert({
            type: 'sms',
            recipients: 'training_assign',
            subject: null,
            message: 'Training Assigned',
            status: 'queued',
            total_recipients: targets.length,
            successful_count: 0,
            failed_count: targets.length,
            created_by: (req as AdminAuthRequest).user.id
          });
        if (smsLogError) {
          console.warn('Training SMS log insert failed (ignored):', smsLogError.message);
        }
      } catch (e) {
        // ignore
      }
    }

    return res.json({ assigned: inserted?.length || 0, targets });
  } catch (error) {
    console.error('Admin training assign error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to assign participants' });
  }
});

// PUT /api/admin/trainings/:id/attendance - mark attendance in bulk
router.put('/trainings/:id/attendance', requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabaseAdminClient();
    const { updates } = req.body || {};

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'updates[] is required' });
    }

    const rows = updates.map(u => ({
      session_id: req.params.id,
      participant_id: u.participant_id,
      attendance_status: u.attendance_status,
      checked_in_at: u.attendance_status ? new Date().toISOString() : null,
      notes: u.notes || null
    }));

    const { data, error } = await supabase
      .from('training_participants')
      .upsert(rows, { onConflict: 'session_id,participant_id' })
      .select();

    if (error) throw error;

    // If session is marked completed, update placement training flags for participants marked present/late
    const { data: training } = await supabase
      .from('training_sessions')
      .select('status')
      .eq('id', req.params.id)
      .maybeSingle();

    if (training?.status === 'completed') {
      const completedIds = rows
        .filter(r => r.attendance_status === 'present' || r.attendance_status === 'late')
        .map(r => r.participant_id);
      if (completedIds.length) {
        try {
          await supabase
            .from('placements')
            .update({
              training_completed: true,
              training_completed_at: new Date().toISOString(),
              zoom_session_attended: true
            })
            .in('graduate_id', completedIds)
            .eq('status', 'pending');
        } catch {
          // ignore (matches previous fire-and-forget .catch)
        }
      }
    }

    return res.json({ updated: data || [] });
  } catch (error) {
    console.error('Admin training attendance error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to update attendance' });
  }
});

export default router;

