import express from 'express';
import crypto from 'crypto';
import { getSupabaseClient, getSupabaseAdminClient } from '../lib/supabase.js';
import { requireAdmin } from '../middleware/auth.js';
import { sendNotificationEmail } from '../services/email-service.js';

const router = express.Router();

// GET /api/admin/users - List all users
router.get('/users', requireAdmin, async (req, res) => {
  try {
    // Use admin client to bypass RLS and see all users
    const supabaseAdmin = getSupabaseAdminClient();
    const role = req.query.role;
    const verified = req.query.verified;
    const search = req.query.search;
    const page = parseInt(req.query.page || '1');
    const limit = parseInt(req.query.limit || '50');
    const offset = (page - 1) * limit;
    
    let query = supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });
    
    if (role) {
      query = query.eq('role', role);
    }
    
    if (verified === 'true' || verified === 'false') {
      query = query.eq('is_verified', verified === 'true');
    }
    
    if (search) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,farm_name.ilike.%${search}%,institution_name.ilike.%${search}%`);
    }
    
    query = query.range(offset, offset + limit - 1);
    
    const { data: users, error, count } = await query;
    
    if (error) {
      console.error('Error fetching users:', error);
      throw error;
    }
    
    return res.json({
      users: users || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Admin users fetch error:', error);
    return res.status(500).json({ error: error.message || 'Failed to fetch users' });
  }
});

// ============================================
// COMMUNICATIONS (Email / SMS)
// ============================================

// GET /api/admin/communications/logs - View sent message logs
router.get('/communications/logs', requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const limit = parseInt(req.query.limit || '50');

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
    return res.status(500).json({ error: error.message || 'Failed to fetch logs' });
  }
});

// POST /api/admin/communications/send - Send bulk or single message
router.post('/communications/send', requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { type, recipients, subject, message, userId, email } = req.body || {};

    if (!type || !recipients || !message) {
      return res.status(400).json({ error: 'type, recipients, and message are required' });
    }

    if (type === 'email' && !subject) {
      return res.status(400).json({ error: 'subject is required for email' });
    }

    // Resolve recipients
    let targets = [];

    if (recipients === 'single') {
      if (userId) {
        const { data } = await supabaseAdmin
          .from('profiles')
          .select('id, email, full_name, phone, role')
          .eq('id', userId)
          .maybeSingle();
        if (data) targets = [data];
      } else if (email) {
        const { data } = await supabaseAdmin
          .from('profiles')
          .select('id, email, full_name, phone, role')
          .eq('email', email)
          .maybeSingle();
        if (data) targets = [data];
      } else {
        return res.status(400).json({ error: 'userId or email is required for single recipient' });
      }
    } else {
      let query = supabaseAdmin
        .from('profiles')
        .select('id, email, full_name, phone, role');

      if (recipients === 'farms') query = query.eq('role', 'farm');
      if (recipients === 'graduates') query = query.eq('role', 'graduate');
      if (recipients === 'students') query = query.eq('role', 'student');
      // 'all' -> no filter

      const { data } = await query;
      targets = data || [];
    }

    const recipientCount = targets.length;

    // Create log record first
    const logPayload = {
      type,
      recipients,
      subject: subject || null,
      message,
      recipient_count: recipientCount,
      success_count: 0,
      failure_count: 0,
      status: 'sending',
      created_by: req.user.id
    };

    let logId = null;
    const { data: logRow } = await supabaseAdmin
      .from('communication_logs')
      .insert(logPayload)
      .select()
      .maybeSingle();
    logId = logRow?.id || null;

    let successCount = 0;
    let failureCount = 0;
    const failures = [];

    if (type === 'email') {
      const { sendNotificationEmail } = await import('../services/email-service.js');

      for (const t of targets) {
        if (!t.email) continue;
        const result = await sendNotificationEmail(t.email, subject, message, t.full_name || '', { role: t.role });
        if (result?.success) {
          successCount += 1;
        } else {
          failureCount += 1;
          failures.push({ email: t.email, error: result?.error || 'Failed to send' });
        }
      }
    } else if (type === 'sms') {
      // SMS provider not configured yet. We log the attempt.
      failureCount = recipientCount;
      failures.push({ error: 'SMS provider not configured' });
    } else {
      return res.status(400).json({ error: 'Invalid type. Use email or sms.' });
    }

    // Update log status
    if (logId) {
      await supabaseAdmin
        .from('communication_logs')
        .update({
          success_count: successCount,
          failure_count: failureCount,
          status: type === 'sms' ? 'failed' : 'sent',
          error_details: failures.length ? failures : null
        })
        .eq('id', logId);
    }

    return res.json({
      message: type === 'sms'
        ? 'SMS provider not configured yet. Logged the attempt.'
        : 'Message sent',
      logId,
      recipientCount,
      successCount,
      failureCount
    });
  } catch (error) {
    console.error('Communications send error:', error);
    return res.status(500).json({ error: error.message || 'Failed to send message' });
  }
});

// ============================================
// SYSTEM SETTINGS
// ============================================

const DEFAULT_SETTINGS = {
  recruitment_fee: 200,
  salary_benchmark_min: 500,
  salary_benchmark_max: 2000,
  email_notifications_enabled: true,
  sms_notifications_enabled: false
};

// GET /api/admin/settings
router.get('/settings', requireAdmin, async (req, res) => {
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
    return res.status(500).json({ error: error.message || 'Failed to fetch settings' });
  }
});

// PUT /api/admin/settings
router.put('/settings', requireAdmin, async (req, res) => {
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
          updated_by: req.user.id,
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
    return res.status(500).json({ error: error.message || 'Failed to save settings' });
  }
});

// ============================================
// TRAINING MANAGEMENT (Admin)
// ============================================

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
    const page = parseInt(req.query.page || '1');
    const limit = parseInt(req.query.limit || '50');
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
    return res.status(500).json({ error: error.message || 'Failed to fetch trainings' });
  }
});

// POST /api/admin/trainings - create session
router.post('/trainings', requireAdmin, async (req, res) => {
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
        created_by: req.user.id
      })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ training: session });
  } catch (error) {
    console.error('Admin trainings create error:', error);
    return res.status(500).json({ error: error.message || 'Failed to create training' });
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
    return res.status(500).json({ error: error.message || 'Failed to fetch training' });
  }
});

// POST /api/admin/trainings/:id/assign - assign participants (selected IDs OR by filters)
router.post('/trainings/:id/assign', requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabaseAdminClient();
    const { userIds, role, region, search, notify_email, notify_sms } = req.body || {};

    // Resolve targets
    let targets = [];
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
      assigned_by: req.user.id
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
      const trainingLinkForRole = (role) => {
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
        try {
          const trainingLinkForRole = (role) => {
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

          await sendNotificationEmail(
            t.email,
            'Training Assigned - AgroTalent Hub',
            `You have been assigned to a training session: <b>${training?.title || 'Training Session'}</b><br/><br/>
            <b>Date/Time:</b> ${training?.scheduled_at ? new Date(training.scheduled_at).toLocaleString() : ''}<br/>
            <b>Region:</b> ${training?.region || ''}<br/>
            <b>Zoom Link:</b> ${training?.zoom_link || 'See dashboard'}<br/><br/>
            Please log in to your dashboard to view details.`,
            t.full_name || '',
            { role: t.role, ctaUrl: trainingLinkForRole(t.role), ctaText: 'View Training' }
          );
        } catch (e) {
          // ignore individual failures
        }
      }
    }

    // Log sms request (actual SMS integration later)
    if (notify_sms) {
      try {
        const { error: smsLogError } = await supabase
          .from('communication_logs')
          .insert({
            type: 'sms',
            recipients: 'training_assign',
            subject: 'Training Assigned',
            message: `Training assigned to ${targets.length} users (SMS not yet integrated).`,
            status: 'queued',
            total_recipients: targets.length,
            successful_count: 0,
            failed_count: targets.length,
            created_by: req.user.id
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
    return res.status(500).json({ error: error.message || 'Failed to assign participants' });
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
        await supabase
          .from('placements')
          .update({
            training_completed: true,
            training_completed_at: new Date().toISOString(),
            zoom_session_attended: true
          })
          .in('graduate_id', completedIds)
          .eq('status', 'pending')
          .catch(() => {});
      }
    }

    return res.json({ updated: data || [] });
  } catch (error) {
    console.error('Admin training attendance error:', error);
    return res.status(500).json({ error: error.message || 'Failed to update attendance' });
  }
});

// GET /api/admin/users/:id - Get single user details
router.get('/users/:id', requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    
    // Get user profile with all details
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.params.id)
      .single();
    
    if (profileError || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get user documents
    const { data: documents } = await supabaseAdmin
      .from('documents')
      .select('*')
      .eq('user_id', req.params.id)
      .order('uploaded_at', { ascending: false });
    
    // Get user applications (if graduate/student)
    let applications = null;
    if (profile.role === 'graduate' || profile.role === 'student') {
      const { data: apps } = await supabaseAdmin
        .from('applications')
        .select(`
          *,
          jobs:job_id (
            id,
            title,
            location,
            job_type,
            status
          )
        `)
        .eq('applicant_id', req.params.id)
        .order('created_at', { ascending: false })
        .limit(10);
      applications = apps;
    }
    
    // Get farm jobs (if farm)
    let jobs = null;
    if (profile.role === 'farm') {
      const { data: farmJobs } = await supabaseAdmin
        .from('jobs')
        .select('*')
        .eq('farm_id', req.params.id)
        .order('created_at', { ascending: false })
        .limit(10);
      jobs = farmJobs;
    }
    
    // Get placements
    let placements = null;
    if (profile.role === 'farm') {
      const { data: farmPlacements } = await supabaseAdmin
        .from('placements')
        .select(`
          *,
          graduate:graduate_id (
            id,
            full_name,
            email,
            phone
          ),
          jobs:job_id (
            id,
            title
          )
        `)
        .eq('farm_id', req.params.id)
        .order('created_at', { ascending: false })
        .limit(10);
      placements = farmPlacements;
    } else if (profile.role === 'graduate' || profile.role === 'student') {
      const { data: gradPlacements } = await supabaseAdmin
        .from('placements')
        .select(`
          *,
          farm:farm_id (
            id,
            farm_name,
            email,
            phone
          ),
          jobs:job_id (
            id,
            title
          )
        `)
        .eq('graduate_id', req.params.id)
        .order('created_at', { ascending: false })
        .limit(10);
      placements = gradPlacements;
    }
    
    return res.json({
      profile,
      documents: documents || [],
      applications: applications || [],
      jobs: jobs || [],
      placements: placements || []
    });
  } catch (error) {
    console.error('Error fetching user details:', error);
    return res.status(500).json({ error: error.message || 'Failed to fetch user details' });
  }
});

// GET /api/admin/documents - List documents for verification
router.get('/documents', requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const documentType = req.query.document_type;
    const status = req.query.status;
    const search = req.query.search;
    const page = parseInt(req.query.page || '1');
    const limit = parseInt(req.query.limit || '50');
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
    return res.status(500).json({ error: error.message || 'Failed to fetch documents' });
  }
});

// POST /api/admin/documents/:id/approve - Approve document
router.post('/documents/:id/approve', requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { data: document, error } = await supabaseAdmin
      .from('documents')
      .update({
        status: 'approved',
        reviewed_by: req.user.id,
        reviewed_at: new Date().toISOString(),
        rejection_reason: null
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ document });
  } catch (error) {
    console.error('Admin document approve error:', error);
    return res.status(500).json({ error: error.message || 'Failed to approve document' });
  }
});

// POST /api/admin/documents/:id/reject - Reject document
router.post('/documents/:id/reject', requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { reason } = req.body || {};
    const { data: document, error } = await supabaseAdmin
      .from('documents')
      .update({
        status: 'rejected',
        reviewed_by: req.user.id,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason || null
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ document });
  } catch (error) {
    console.error('Admin document reject error:', error);
    return res.status(500).json({ error: error.message || 'Failed to reject document' });
  }
});

// POST /api/admin/users/create - Create user
router.post('/users/create', requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const supabaseAdmin = getSupabaseAdminClient();
    const {
      email,
      password,
      full_name,
      phone,
      role,
      is_verified,
      farm_name,
      farm_type,
      farm_location,
      institution_name,
      institution_type,
      qualification,
      specialization,
      preferred_region
    } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({
        error: 'Email, password, and role are required'
      });
    }

    if (role === 'farm' && !farm_name) {
      return res.status(400).json({
        error: 'Farm name is required for farm accounts'
      });
    }

    if ((role === 'graduate' || role === 'student') && !institution_name) {
      return res.status(400).json({
        error: 'Institution name is required for graduate/student accounts'
      });
    }

    // Build user_metadata so trigger handle_new_user can satisfy profile CHECK constraints (farm_name / institution_name)
    const userMetadata = { full_name: full_name || '', role };
    if (role === 'farm') userMetadata.farm_name = farm_name || 'Unknown';
    if (role === 'graduate' || role === 'student') userMetadata.institution_name = institution_name || 'Unknown';

    // Create auth user (trigger creates profile with id, email, role, full_name, farm_name or institution_name)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });

    if (authError) throw authError;

    if (!authData.user) {
      return res.status(500).json({ error: 'Failed to create user' });
    }

    // Update profile with extra fields (trigger already created the row)
    const profileUpdate = {
      full_name: full_name || null,
      phone: phone || null,
      is_verified: is_verified || false,
    };

    if (is_verified) {
      profileUpdate.verified_at = new Date().toISOString();
      profileUpdate.verified_by = req.user.id;
    }

    if (role === 'farm') {
      profileUpdate.farm_name = farm_name;
      profileUpdate.farm_type = farm_type || null;
      profileUpdate.farm_location = farm_location || null;
    }

    if (role === 'graduate' || role === 'student') {
      profileUpdate.institution_name = institution_name;
      profileUpdate.institution_type = institution_type || null;
      profileUpdate.qualification = qualification || null;
      profileUpdate.specialization = specialization || null;
      profileUpdate.preferred_region = preferred_region || null;
    }

    const { data: updatedProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .update(profileUpdate)
      .eq('id', authData.user.id)
      .select()
      .single();

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      throw profileError;
    }

    return res.status(201).json({
      user: authData.user,
      profile: updatedProfile,
      message: 'User created successfully'
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Failed to create user'
    });
  }
});

// POST /api/admin/ensure-unknown-farm - Get or create the "Farm (unknown)" placeholder for admin job posting
const UNKNOWN_FARM_EMAIL = 'unknown-farm@system.agrotalenthub.internal';
router.post('/ensure-unknown-farm', requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('role', 'farm')
      .eq('email', UNKNOWN_FARM_EMAIL)
      .maybeSingle();

    if (existing) {
      return res.json({ profile: existing });
    }

    const password = crypto.randomBytes(24).toString('hex');
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: UNKNOWN_FARM_EMAIL,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Farm (unknown)', role: 'farm', farm_name: 'Farm (unknown)' },
    });

    if (authError) {
      return res.status(500).json({ error: authError.message || 'Failed to create placeholder farm' });
    }
    if (!authData.user) {
      return res.status(500).json({ error: 'Failed to create placeholder farm' });
    }

    // Trigger handle_new_user already created the profile; update is_verified and return it
    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ is_verified: true })
      .eq('id', authData.user.id)
      .select()
      .single();

    if (updateError) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return res.status(500).json({ error: updateError.message || 'Failed to update placeholder profile' });
    }

    return res.json({ profile: updatedProfile });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to ensure unknown farm' });
  }
});

// POST /api/admin/verify/:id - Verify user
router.post('/verify/:id', requireAdmin, async (req, res) => {
  try {
    // Use admin client to bypass RLS
    const supabaseAdmin = getSupabaseAdminClient();
    const { verified, notes } = req.body;
    
    const updateData = {
      is_verified: verified !== undefined ? verified : true,
      verified_at: verified !== undefined && verified ? new Date().toISOString() : null,
      verified_by: verified !== undefined && verified ? req.user.id : null
    };
    
    // Use maybeSingle() instead of single() to handle cases where profile might not exist
    const { data: updatedProfile, error } = await supabaseAdmin
      .from('profiles')
      .update(updateData)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();
    
    if (error) {
      console.error('Error updating profile:', error);
      throw error;
    }
    
    if (!updatedProfile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    // Create in-app notification
    if (verified) {
      const dashboardPathForRole = (role) => {
        switch (role) {
          case 'admin':
            return '/dashboard/admin';
          case 'farm':
            return '/dashboard/farm';
          case 'student':
            return '/dashboard/student';
          case 'graduate':
            return '/dashboard/graduate';
          case 'worker':
            // Worker dashboard not implemented yet; use applicant dashboard for now.
            return '/dashboard/graduate';
          default:
            return '/signin';
        }
      };

      const dashboardPath = dashboardPathForRole(updatedProfile.role);

      await supabaseAdmin
        .from('notifications')
        .insert({
          user_id: req.params.id,
          type: 'placement_confirmed',
          title: 'Profile Verified',
          message: 'Your profile has been verified. You can now apply to jobs!',
          link: dashboardPath
        });
      
      // Send email notification
      try {
        const { sendNotificationEmail } = await import('../services/email-service.js');
        const emailResult = await sendNotificationEmail(
          updatedProfile.email,
          'Profile Verified - AgroTalent Hub',
          `Great news! Your profile has been verified by our admin team. You can now:\n\n- Browse and apply to job opportunities\n- Receive job match notifications\n- Connect with employers directly\n\nClick the button below to continue.`,
          updatedProfile.full_name || '',
          { role: updatedProfile.role, ctaUrl: dashboardPath, ctaText: 'Open Dashboard' }
        );
        
        if (!emailResult.success) {
          console.warn('Failed to send verification email:', emailResult.error);
        }
      } catch (emailError) {
        console.error('Error sending verification email:', emailError);
        // Don't fail the verification if email fails
      }
    }
    
    return res.json({
      profile: updatedProfile,
      message: verified ? 'Profile verified successfully' : 'Verification removed'
    });
  } catch (error) {
    console.error('Admin verify error:', error);
    return res.status(500).json({ error: error.message || 'Failed to verify user' });
  }
});

// GET /api/admin/jobs - List all jobs from all employers
router.get('/jobs', requireAdmin, async (req, res) => {
  try {
    // Use admin client to bypass RLS and see all jobs
    const supabaseAdmin = getSupabaseAdminClient();
    const status = req.query.status;
    const farmId = req.query.farm_id;
    const location = req.query.location;
    const jobType = req.query.job_type;
    const page = parseInt(req.query.page || '1');
    const limit = parseInt(req.query.limit || '100');
    const offset = (page - 1) * limit;
    
    let query = supabaseAdmin
      .from('jobs')
      .select(`
        *,
        profiles:farm_id (
          id,
          farm_name,
          farm_type,
          farm_location,
          email
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false });
    
    // Don't filter by status by default - show all jobs
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }
    
    if (farmId) {
      query = query.eq('farm_id', farmId);
    }
    
    if (location) {
      query = query.eq('location', location);
    }
    
    if (jobType) {
      query = query.eq('job_type', jobType);
    }
    
    query = query.range(offset, offset + limit - 1);
    
    const { data: jobs, error, count } = await query;
    
    if (error) {
      console.error('Error fetching admin jobs:', error);
      throw error;
    }
    
    return res.json({
      jobs: jobs || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Admin jobs fetch error:', error);
    return res.status(500).json({ error: error.message || 'Failed to fetch jobs' });
  }
});

// DELETE /api/admin/jobs - Delete all jobs (Admin only)
router.delete('/jobs', requireAdmin, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { error } = await supabaseAdmin.from('jobs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw error;
    return res.status(204).send();
  } catch (error) {
    console.error('Admin delete all jobs error:', error);
    return res.status(500).json({ error: error.message || 'Failed to delete jobs' });
  }
});

// GET /api/admin/applications - List all applications
router.get('/applications', requireAdmin, async (req, res) => {
  try {
    // Use admin client to bypass RLS
    const supabase = getSupabaseAdminClient();
    const status = req.query.status;
    const jobId = req.query.job_id;
    const applicantId = req.query.applicant_id;
    const page = parseInt(req.query.page || '1');
    const limit = parseInt(req.query.limit || '50');
    const offset = (page - 1) * limit;
    
    let query = supabase
      .from('applications')
      .select(`
        *,
        jobs:job_id (
          id,
          title,
          description,
          location,
          job_type,
          salary_min,
          salary_max,
          status,
          profiles:farm_id (
            farm_name,
            farm_type,
            farm_location
          )
        ),
        applicant:applicant_id (
          id,
          full_name,
          email,
          phone,
          qualification,
          institution_name,
          specialization,
          preferred_region,
          is_verified,
          role
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false });
    
    if (status) {
      query = query.eq('status', status);
    }
    
    if (jobId) {
      query = query.eq('job_id', jobId);
    }
    
    if (applicantId) {
      query = query.eq('applicant_id', applicantId);
    }
    
    query = query.range(offset, offset + limit - 1);
    
    const { data: applications, error, count } = await query;
    
    if (error) throw error;
    
    return res.json({
      applications: applications || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/placements - List all placements
router.get('/placements', requireAdmin, async (req, res) => {
  try {
    // Use admin client to bypass RLS
    const supabase = getSupabaseAdminClient();
    const status = req.query.status;
    const region = req.query.region;
    const startDate = req.query.start_date;
    const endDate = req.query.end_date;
    const page = parseInt(req.query.page || '1');
    const limit = parseInt(req.query.limit || '50');
    const offset = (page - 1) * limit;
    
    let query = supabase
      .from('placements')
      .select(`
        *,
        jobs:job_id (
          id,
          title,
          location,
          job_type
        ),
        farm:farm_id (
          id,
          farm_name,
          farm_location
        ),
        graduate:graduate_id (
          id,
          full_name,
          email,
          preferred_region,
          qualification
        ),
        applications:application_id (
          id,
          status
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false });
    
    if (status) {
      query = query.eq('status', status);
    }
    
    if (region) {
      query = query.eq('jobs.location', region);
    }

    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }
    
    query = query.range(offset, offset + limit - 1);
    
    const { data: placements, error, count } = await query;
    
    if (error) throw error;
    
    return res.json({
      placements: placements || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/reports - Generate reports
router.get('/reports', requireAdmin, async (req, res) => {
  try {
    // Use admin client to bypass RLS
    const supabase = getSupabaseAdminClient();
    const reportType = req.query.type || 'overview';
    const startDate = req.query.start_date;
    const endDate = req.query.end_date;
    
    let report = {};
    
    if (reportType === 'overview' || reportType === 'all') {
      // Parallelize all count queries for better performance
      const [
        { count: totalUsers },
        { count: farms },
        { count: graduates },
        { count: students },
        { count: verified },
        { count: activeJobs },
        { count: totalApplications },
        { count: activePlacements },
        { count: completedPlacements }
      ] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'farm'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'graduate'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'student'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('is_verified', true),
        supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('applications').select('*', { count: 'exact', head: true }),
        supabase.from('placements').select('*', { count: 'exact', head: true }).in('status', ['active', 'training']),
        supabase.from('placements').select('*', { count: 'exact', head: true }).eq('status', 'completed')
      ]);
      
      report.overview = {
        total_users: totalUsers || 0,
        farms: farms || 0,
        graduates: graduates || 0,
        students: students || 0,
        verified_users: verified || 0,
        active_jobs: activeJobs || 0,
        total_applications: totalApplications || 0,
        active_placements: activePlacements || 0,
        completed_placements: completedPlacements || 0
      };
    }
    
    if (reportType === 'regional' || reportType === 'all') {
      const { data: regionalData } = await supabase
        .from('placements')
        .select(`
          jobs:job_id (
            location
          )
        `)
        .in('status', ['active', 'completed']);
      
      const regionalStats = {};
      regionalData?.forEach((placement) => {
        const region = placement.jobs?.location || 'Unknown';
        regionalStats[region] = (regionalStats[region] || 0) + 1;
      });
      
      report.regional = regionalStats;
    }
    
    if (reportType === 'payments' || reportType === 'all') {
      let paymentQuery = supabase
        .from('payments')
        .select('amount, status, created_at');
      
      if (startDate) {
        paymentQuery = paymentQuery.gte('created_at', startDate);
      }
      if (endDate) {
        paymentQuery = paymentQuery.lte('created_at', endDate);
      }
      
      const { data: payments } = await paymentQuery;
      
      const totalRevenue = payments?.reduce((sum, p) => {
        return sum + (p.status === 'completed' ? parseFloat(p.amount.toString()) : 0);
      }, 0) || 0;
      
      const pendingPayments = payments?.filter(p => p.status === 'pending').length || 0;
      const completedPayments = payments?.filter(p => p.status === 'completed').length || 0;
      
      report.payments = {
        total_revenue: totalRevenue,
        pending_payments: pendingPayments,
        completed_payments: completedPayments,
        total_payments: payments?.length || 0
      };
    }
    
    if (reportType === 'training' || reportType === 'all') {
      const { count: totalSessions } = await supabase
        .from('training_sessions')
        .select('*', { count: 'exact', head: true });
      
      const { count: attendanceRecords } = await supabase
        .from('training_attendance')
        .select('*', { count: 'exact', head: true })
        .eq('attended', true);
      
      report.training = {
        total_sessions: totalSessions || 0,
        total_attendance: attendanceRecords || 0
      };
    }
    
    return res.json({ report });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/contact - Get contact submissions
router.get('/contact', requireAdmin, async (req, res) => {
  try {
    // Use admin client to bypass RLS
    const supabase = getSupabaseAdminClient();
    const status = req.query.status;
    
    let query = supabase
      .from('contact_submissions')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data: submissions, error } = await query;
    
    if (error) {
      if (error.message.includes('does not exist')) {
        return res.json({ submissions: [] });
      }
      throw error;
    }
    
    return res.json({ submissions: submissions || [] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/payments - List payments (Admin only)
router.get('/payments', requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabaseAdminClient();
    const status = req.query.status;
    const startDate = req.query.start_date;
    const endDate = req.query.end_date;
    const page = parseInt(req.query.page || '1');
    const limit = parseInt(req.query.limit || '50');
    const offset = (page - 1) * limit;

    let query = supabase
      .from('payments')
      .select(
        `
        *,
        placements:placement_id (
          id,
          status,
          jobs:job_id ( id, title, location ),
          farm:farm_id ( id, farm_name, email )
        )
      `,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);

    query = query.range(offset, offset + limit - 1);

    const { data: payments, error, count } = await query;
    if (error) throw error;

    return res.json({
      payments: payments || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Admin payments fetch error:', error);
    return res.status(500).json({ error: error.message || 'Failed to fetch payments' });
  }
});

export default router;
