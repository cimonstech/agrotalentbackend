import express from 'express';
import { getSupabaseClient, getSupabaseAdminClient } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';
import type { AuthRequest } from '../types/auth.js';
import { queryParamToString } from '../lib/query.js';
import { errorMessage } from '../lib/errors.js'
import { validate } from '../lib/validate.js'
import {
  createApplicationSchema,
  updateApplicationStatusSchema,
} from '../lib/schemas.js'
import { calculateMatchScore } from '../services/matching-service.js';
import { sendApplicationReceivedEmail, sendApplicationStatusEmail } from '../services/email-service.js';
import { sendApplicationReceivedSms, sendApplicationStatusSms } from '../services/sms-service.js';
import { schedulePlacementConfirmedEmail } from './placements.js';

const router = express.Router();

function relationOne<T>(rel: T | T[] | null | undefined): T | undefined {
  if (rel == null) return undefined;
  return Array.isArray(rel) ? rel[0] : rel;
}

interface ApplicantAgg {
  id: string;
  full_name: string;
  email: string;
  is_verified: boolean;
  role: string | null;
  total_applications: number;
  applications: Array<{
    id: string;
    job_id: string;
    job_title: string;
    status: string;
    match_score: number | null;
    created_at: string;
  }>;
  latest_application_date: string | null;
}

const escapeHtml = (value: unknown) => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// GET /api/applicants - Get unique applicants for farm (only for farms)
router.get('/applicants', authenticate, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const page = Math.max(parseInt(queryParamToString(req.query.page) || '1', 10), 1);
    const requestedLimit = parseInt(queryParamToString(req.query.limit) || '25', 10);
    const limit = Math.min(Math.max(requestedLimit, 1), 100);
    
    // Use admin client to fetch profile to bypass RLS
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', (req as AuthRequest).user.id)
      .single();
    
    if (profileError || !profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    // Only farms can access this endpoint
    if (profile.role !== 'farm') {
      return res.status(403).json({ error: 'Only farms can access applicants list' });
    }
    
    // Get farm's job IDs
    const { data: farmJobs } = await supabaseAdmin
      .from('jobs')
      .select('id, title')
      .eq('farm_id', (req as AuthRequest).user.id);
    
    const jobIds = farmJobs?.map(j => j.id) || [];
    
    if (jobIds.length === 0) {
      return res.json({
        applicants: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0
        }
      });
    }
    
    // Get all applications for farm's jobs with applicant details
    const { data: applications, error: appsError } = await supabaseAdmin
      .from('applications')
      .select(`
        id,
        applicant_id,
        job_id,
        status,
        match_score,
        created_at,
        jobs:job_id (
          id,
          title
        ),
        applicant:applicant_id (
          id,
          full_name,
          email,
          is_verified,
          role
        )
      `)
      .in('job_id', jobIds)
      .order('created_at', { ascending: false });
    
    if (appsError) {
      console.error('[GET /applicants] Query error:', appsError);
      throw appsError;
    }
    
    // Group applications by applicant_id to get unique applicants
    const applicantsMap = new Map<string, ApplicantAgg>();
    
    (applications || []).forEach((app: Record<string, unknown>) => {
      const applicantId = app.applicant_id as string;
      const applicantRow = relationOne(app.applicant as { full_name?: string; email?: string; is_verified?: boolean; role?: string } | null);
      const jobRow = relationOne(app.jobs as { title?: string } | null);
      
      if (!applicantsMap.has(applicantId)) {
        applicantsMap.set(applicantId, {
          id: applicantId,
          full_name: applicantRow?.full_name || 'N/A',
          email: applicantRow?.email || 'N/A',
          is_verified: applicantRow?.is_verified || false,
          role: applicantRow?.role || null,
          total_applications: 0,
          applications: [],
          latest_application_date: null
        });
      }
      
      const applicant = applicantsMap.get(applicantId)!;
      applicant.total_applications += 1;
      applicant.applications.push({
        id: String(app.id),
        job_id: String(app.job_id),
        job_title: jobRow?.title || 'N/A',
        status: String(app.status),
        match_score: (app.match_score as number | null) ?? null,
        created_at: String(app.created_at)
      });
      
      if (!applicant.latest_application_date || new Date(String(app.created_at)) > new Date(applicant.latest_application_date)) {
        applicant.latest_application_date = String(app.created_at);
      }
    });
    
    // Convert map to array and sort by latest application date
    const allApplicants = Array.from(applicantsMap.values()).sort((a, b) => {
      const dateA = new Date(a.latest_application_date || 0);
      const dateB = new Date(b.latest_application_date || 0);
      return dateB.getTime() - dateA.getTime();
    });
    
    const total = allApplicants.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const end = start + limit;
    const applicants = allApplicants.slice(start, end);
    
    return res.json({
      applicants,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    });
  } catch (error) {
    console.error('[GET /applicants] Error:', error);
    return res.status(500).json({ error: errorMessage(error) });
  }
});

// GET /api/applications - Get applications (role-based)
router.get('/', authenticate, async (req, res) => {
  try {
    const supabase = (req as AuthRequest).supabase;
    const supabaseAdmin = getSupabaseAdminClient();
    
    // Use admin client to fetch profile to bypass RLS
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', (req as AuthRequest).user.id)
      .single();
    
    if (profileError || !profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    let query;
    
    if (profile.role === 'farm') {
      // Farms see applications for their jobs
      // Use admin client to bypass RLS and read applicant profiles
      // First get farm's job IDs
      const { data: farmJobs } = await supabaseAdmin
        .from('jobs')
        .select('id')
        .eq('farm_id', (req as AuthRequest).user.id);
      
      const jobIds = farmJobs?.map(j => j.id) || [];
      
      if (jobIds.length === 0) {
        return res.json({ applications: [] });
      }
      
      // Use admin client to ensure farms can read applicant profile data
      query = supabaseAdmin
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
            address,
            required_qualification,
            required_institution_type,
            required_experience_years,
            required_specialization,
            expires_at,
            status,
            created_at
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
            is_verified
          )
        `)
        .in('job_id', jobIds)
        .order('match_score', { ascending: false })
        .order('created_at', { ascending: false });
      
      const { data, error } = await query;
      
      if (error) {
        console.error('[GET /applications] Query error:', error);
        throw error;
      }
      
      // Log first application to debug applicant data
      if (data && data.length > 0) {
        console.log('[GET /applications] Sample application IDs:', {
          applicationId: data[0].id,
          applicantId: data[0].applicant_id
        });
      }
      
      return res.json({ applications: data || [] });
    } else {
      // Graduates/Students see their own applications
      // Use admin client to avoid RLS issues when joining jobs/profiles
      const { data, error } = await supabaseAdmin
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
            profiles:farm_id (
              farm_name,
              farm_type
            )
          )
        `)
        .eq('applicant_id', (req as AuthRequest).user.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      return res.json({ applications: data || [] });
    }
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

// POST /api/applications - Create application
router.post('/', authenticate, validate(createApplicationSchema), async (req, res) => {
  try {
    const supabase = (req as AuthRequest).supabase;
    const supabaseAdmin = getSupabaseAdminClient();
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', (req as AuthRequest).user.id)
      .single();

    if (!profile || !['graduate', 'student', 'skilled'].includes(profile.role)) {
      return res.status(403).json({
        error: 'Only verified graduates, students, and skilled workers can apply'
      });
    }

    if (!profile.is_verified) {
      return res.status(403).json({
        error: 'Your profile must be verified before applying'
      });
    }

    const { job_id, cover_letter } = req.body;

    if (!job_id) {
      return res.status(400).json({
        error: 'Job ID is required'
      });
    }

    const { data: jobFull, error: jobFetchError } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (jobFetchError || !jobFull || jobFull.status !== 'active') {
      return res.status(400).json({
        error: 'Job not found or no longer active'
      });
    }

    const { data: existing } = await supabase
      .from('applications')
      .select('id')
      .eq('job_id', job_id)
      .eq('applicant_id', (req as AuthRequest).user.id)
      .single();

    if (existing) {
      return res.status(400).json({
        error: 'You have already applied for this job'
      });
    }

    const score = calculateMatchScore(
      jobFull as Record<string, unknown>,
      profile as Record<string, unknown>
    );

    const { data: application, error } = await supabase
      .from('applications')
      .insert({
        job_id,
        applicant_id: (req as AuthRequest).user.id,
        cover_letter: cover_letter || null,
        status: 'pending',
        match_score: score,
      })
      .select()
      .single();

    if (error) throw error;

    await supabaseAdmin
      .from('jobs')
      .update({ application_count: (jobFull.application_count || 0) + 1 })
      .eq('id', job_id);

    void (async () => {
      const admin = getSupabaseAdminClient();
      const { data: farm } = await admin
        .from('profiles')
        .select('email, phone, farm_name, full_name')
        .eq('id', jobFull.farm_id)
        .single();
      const applicantName =
        (profile as { full_name?: string | null }).full_name ?? 'Applicant';
      if (farm?.email) {
        await sendApplicationReceivedEmail(
          farm.email,
          farm.farm_name ?? farm.full_name ?? 'Farm',
          applicantName,
          String(jobFull.title)
        );
      }
      if (farm?.phone) {
        void sendApplicationReceivedSms(
          farm.phone,
          farm.farm_name ?? farm.full_name ?? 'Farm',
          applicantName,
          String(jobFull.title)
        ).catch(console.error)
      }

      if (jobFull.is_platform_job) {
        const { data: admins } = await admin
          .from('profiles')
          .select('id, email, full_name, phone')
          .eq('role', 'admin')
        for (const adminUser of admins ?? []) {
          void (async () => {
            try {
              await admin
                .from('notifications')
                .insert({
                  user_id: adminUser.id,
                  type: 'application_received',
                  title: 'New Application on Platform Job',
                  message: applicantName + ' applied for ' + String(jobFull.title),
                  read: false,
                })
            } catch (insertError) {
              console.error(insertError)
            }
          })()

          if (adminUser.email) {
            void sendApplicationReceivedEmail(
              adminUser.email,
              adminUser.full_name ?? 'Admin',
              applicantName,
              String(jobFull.title)
            ).catch(console.error)
          }
        }
      }
    })().catch(console.error);

    return res.status(201).json({ application });
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

// GET /api/applications/:id/documents - Get applicant documents (farm only, for viewing an application)
router.get('/:id/documents', authenticate, async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const applicationId = req.params.id;

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', (req as AuthRequest).user.id)
      .single();

    if (profileError || !profile || profile.role !== 'farm') {
      return res.status(403).json({ error: 'Only employers can view applicant documents' });
    }

    const { data: application, error: appError } = await supabaseAdmin
      .from('applications')
      .select('id, applicant_id, job_id, jobs:job_id (farm_id)')
      .eq('id', applicationId)
      .single();

    if (appError || !application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const jobsRel = relationOne(application.jobs as { farm_id?: string } | null);
    const farmId = jobsRel?.farm_id;
    if (!farmId || farmId !== (req as AuthRequest).user.id) {
      return res.status(403).json({ error: 'You can only view documents for applicants to your jobs' });
    }

    const applicantUserId = application.applicant_id;
    const { data: documents, error: docsError } = await supabaseAdmin
      .from('documents')
      .select('id, document_type, file_name, file_url, uploaded_at')
      .eq('user_id', applicantUserId)
      .order('uploaded_at', { ascending: false });

    if (docsError) {
      return res.status(500).json({ error: docsError.message || 'Failed to fetch documents' });
    }

    return res.json({ documents: documents || [] });
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

// PATCH /api/applications/:id - Update application status
router.patch(
  '/:id',
  authenticate,
  validate(updateApplicationStatusSchema),
  async (req, res) => {
  try {
    console.log('[PATCH applications] Body received:', JSON.stringify(req.body))
    console.log('[PATCH applications] Params:', req.params)

    const supabase = (req as AuthRequest).supabase ?? getSupabaseClient();
    const supabaseAdmin = getSupabaseAdminClient();
    
    // Use admin client to fetch profile to ensure we can read it regardless of RLS
    console.log('[PATCH /applications/:id] Checking user role for:', (req as AuthRequest).user.id);
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role, id')
      .eq('id', (req as AuthRequest).user.id)
      .single();
    
    console.log('[PATCH /applications/:id] Profile fetch result:', { profile, profileError });
    
    if (profileError || !profile) {
      console.error('[PATCH /applications/:id] Profile fetch error:', profileError);
      return res.status(403).json({
        error: 'Unable to verify user role',
        details: profileError?.message || 'Profile not found'
      });
    }
    
    console.log('[PATCH /applications/:id] User role:', profile.role);

    const { status, review_notes } = req.body;

    const { data: application, error: appError } = await supabaseAdmin
      .from('applications')
      .select(`
        *,
        jobs:job_id (
          farm_id,
          title,
          profiles:farm_id (
            farm_name
          )
        ),
        applicant:applicant_id (
          id,
          full_name,
          email,
          role
        )
      `)
      .eq('id', req.params.id)
      .single();

    if (appError || !application) {
      console.error('[PATCH /applications/:id] Application fetch error:', appError);
      return res.status(404).json({ error: 'Application not found' });
    }

    const jobRel = relationOne(application.jobs as {
      farm_id?: string;
      title?: string;
      profiles?: { farm_name?: string } | { farm_name?: string }[] | null;
    } | null);

    console.log('[PATCH /applications/:id] Application IDs:', {
      id: application.id,
      applicantId: application.applicant_id,
      jobId: application.job_id,
      farmId: jobRel?.farm_id
    });

    const applicantSelfRoles = ['graduate', 'student', 'skilled'] as const;
    if (applicantSelfRoles.includes(profile.role as (typeof applicantSelfRoles)[number])) {
      if (application.applicant_id !== (req as AuthRequest).user.id) {
        return res.status(403).json({ error: 'You can only update your own applications' });
      }
      if (status !== 'withdrawn') {
        return res.status(403).json({
          error: 'Applicants may only set status to withdrawn on this endpoint',
        });
      }
      if (review_notes != null && String(review_notes).trim() !== '') {
        return res.status(400).json({ error: 'Review notes cannot be set when withdrawing' });
      }
      const currentStatus = application.status as string;
      if (currentStatus === 'withdrawn') {
        return res.status(400).json({ error: 'Application is already withdrawn' });
      }
      if (currentStatus === 'accepted') {
        return res.status(400).json({
          error: 'Cannot withdraw an accepted application. Contact the employer.',
        });
      }

      const { data: updatedApp, error: withdrawErr } = await supabaseAdmin
        .from('applications')
        .update({
          status: 'withdrawn',
          updated_at: new Date().toISOString(),
        })
        .eq('id', req.params.id)
        .eq('applicant_id', (req as AuthRequest).user.id)
        .select()
        .single();

      if (withdrawErr) throw withdrawErr;
      return res.json({ application: updatedApp });
    }

    if (!['farm', 'admin'].includes(profile.role)) {
      console.error('[PATCH /applications/:id] Invalid role:', profile.role, 'for user:', (req as AuthRequest).user.id);
      return res.status(403).json({
        error: 'Only employers/farms and admins can update application status',
        userRole: profile.role
      });
    }

    if (profile.role === 'farm' && jobRel?.farm_id !== (req as AuthRequest).user.id) {
      return res.status(403).json({
        error: 'You can only update applications for your own jobs'
      });
    }
    
    const updateData: Record<string, unknown> = {
      status,
      reviewed_by: (req as AuthRequest).user.id,
      reviewed_at: new Date().toISOString()
    };
    
    if (review_notes) {
      updateData.review_notes = review_notes;
    }
    
    // If accepted, create placement
    if (status === 'accepted') {
      const { data: placement, error: placementError } = await supabaseAdmin
        .from('placements')
        .insert({
          application_id: req.params.id,
          job_id: application.job_id,
          farm_id: jobRel?.farm_id,
          graduate_id: application.applicant_id,
          status: 'pending'
        })
        .select()
        .single();
      
      if (placementError) throw placementError;

      schedulePlacementConfirmedEmail({
        graduate_id: placement.graduate_id,
        farm_id: placement.farm_id,
        job_id: placement.job_id,
        start_date: placement.start_date ?? null,
      });

      // Create payment record
      await supabaseAdmin
        .from('payments')
        .insert({
          placement_id: placement.id,
          farm_id: jobRel?.farm_id,
          amount: 200.00,
          status: 'pending'
        });
      
      // Update job status
      await supabaseAdmin
        .from('jobs')
        .update({ status: 'filled' })
        .eq('id', application.job_id);
    }
    
    const { data: updated, error } = await supabaseAdmin
      .from('applications')
      .update(updateData)
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (error) throw error;

    if (typeof status === 'string' && status.length > 0) {
      void (async () => {
        const admin = getSupabaseAdminClient();
        const { data: applicantProfile } = await admin
          .from('profiles')
          .select('email, phone, full_name')
          .eq('id', application.applicant_id)
          .single();
        const { data: jobRow } = await admin
          .from('jobs')
          .select('title')
          .eq('id', application.job_id)
          .single();
        if (applicantProfile?.email && jobRow?.title) {
          await sendApplicationStatusEmail(
            applicantProfile.email,
            applicantProfile.full_name ?? 'Applicant',
            jobRow.title,
            status,
            typeof review_notes === 'string' ? review_notes : undefined
          );
        }
        if (applicantProfile?.phone && jobRow?.title) {
          void sendApplicationStatusSms(
            applicantProfile.phone,
            applicantProfile.full_name ?? 'Applicant',
            jobRow.title,
            status
          ).catch(console.error)
        }
      })().catch(console.error);
    }

    const applicantRow = relationOne(application.applicant as { email?: string; full_name?: string; role?: string } | null);
    let applicantEmail = applicantRow?.email;
    if (!applicantEmail && application.applicant_id) {
      const { data: applicantProfile } = await supabaseAdmin
        .from('profiles')
        .select('email, full_name, role')
        .eq('id', application.applicant_id)
        .single();

      if (applicantProfile) {
        applicantEmail = applicantProfile.email;
        const appMut = application as Record<string, unknown>;
        if (!applicantRow) {
          appMut.applicant = applicantProfile;
        } else {
          const merged = { ...applicantRow, ...applicantProfile };
          merged.email = applicantEmail;
          merged.full_name = applicantRow.full_name || applicantProfile.full_name;
          merged.role = applicantRow.role || applicantProfile.role;
          appMut.applicant = merged;
        }
      }
    }

    if (applicantEmail && ['accepted', 'rejected', 'shortlisted'].includes(status)) {
      try {
        const getDashboardPath = (role: string) => {
          switch (role) {
            case 'student': return '/dashboard/student/applications';
            case 'skilled': return '/dashboard/skilled/applications';
            case 'graduate': return '/dashboard/graduate/applications';
            default: return '/dashboard/graduate/applications';
          }
        };

        const applicantForNotif = relationOne(application.applicant as { email?: string; full_name?: string; role?: string } | null);
        let applicantRole = applicantForNotif?.role;
        if (!applicantRole && application.applicant_id) {
          const { data: applicantProfile } = await supabaseAdmin
            .from('profiles')
            .select('role')
            .eq('id', application.applicant_id)
            .single();
          applicantRole = applicantProfile?.role || 'graduate';
        }

        const dashboardPathBase = getDashboardPath(applicantRole || 'graduate');
        const dashboardPath = `${dashboardPathBase}/${application.id}`;
        const jobTitle = jobRel?.title || 'the position';
        const profilesRel = relationOne(jobRel?.profiles ?? null);
        const farmName = profilesRel?.farm_name || 'the employer';
        const safeJobTitle = escapeHtml(jobTitle);
        const safeFarmName = escapeHtml(farmName);

        let notificationTitle = '';
        let notificationMessage = '';
        let notificationType = '';

        if (status === 'accepted') {
          notificationTitle = 'Application Accepted!';
          notificationMessage = `Your application for ${safeJobTitle} at ${safeFarmName} has been accepted!`;
          notificationType = 'application_accepted';
        } else if (status === 'rejected') {
          notificationTitle = 'Application Update';
          notificationMessage = `Your application for ${safeJobTitle} at ${safeFarmName} was not selected.`;
          notificationType = 'application_rejected';
        } else if (status === 'shortlisted') {
          notificationTitle = 'Application Shortlisted!';
          notificationMessage = `Your application for ${safeJobTitle} at ${safeFarmName} has been shortlisted!`;
          notificationType = 'application_shortlisted';
        }

        await supabaseAdmin
          .from('notifications')
          .insert({
            user_id: application.applicant_id,
            type: notificationType,
            title: notificationTitle,
            message: notificationMessage,
            link: dashboardPath
          });
      } catch (notifError) {
        console.error(`Error creating ${status} notification:`, notifError);
      }
    }

    return res.json({ application: updated });
  } catch (error) {
    return res.status(500).json({ error: errorMessage(error) });
  }
});

export default router;
