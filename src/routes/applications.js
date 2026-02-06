import express from 'express';
import { getSupabaseClient, getSupabaseAdminClient } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

const escapeHtml = (value) => {
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
    const page = Math.max(parseInt(req.query.page || '1'), 1);
    const requestedLimit = parseInt(req.query.limit || '25');
    const limit = Math.min(Math.max(requestedLimit, 1), 100);
    
    // Use admin client to fetch profile to bypass RLS
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
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
      .eq('farm_id', req.user.id);
    
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
    const applicantsMap = new Map();
    
    (applications || []).forEach((app) => {
      const applicantId = app.applicant_id;
      
      if (!applicantsMap.has(applicantId)) {
        applicantsMap.set(applicantId, {
          id: applicantId,
          full_name: app.applicant?.full_name || 'N/A',
          email: app.applicant?.email || 'N/A',
          is_verified: app.applicant?.is_verified || false,
          role: app.applicant?.role || null,
          total_applications: 0,
          applications: [],
          latest_application_date: null
        });
      }
      
      const applicant = applicantsMap.get(applicantId);
      applicant.total_applications += 1;
      applicant.applications.push({
        id: app.id,
        job_id: app.job_id,
        job_title: app.jobs?.title || 'N/A',
        status: app.status,
        match_score: app.match_score,
        created_at: app.created_at
      });
      
      // Update latest application date
      if (!applicant.latest_application_date || new Date(app.created_at) > new Date(applicant.latest_application_date)) {
        applicant.latest_application_date = app.created_at;
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
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/applications - Get applications (role-based)
router.get('/', authenticate, async (req, res) => {
  try {
    const supabase = req.supabase;
    const supabaseAdmin = getSupabaseAdminClient();
    
    // Use admin client to fetch profile to bypass RLS
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
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
        .eq('farm_id', req.user.id);
      
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
        .eq('applicant_id', req.user.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      return res.json({ applications: data || [] });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/applications - Create application
router.post('/', authenticate, async (req, res) => {
  try {
    const supabase = req.supabase;
    const supabaseAdmin = getSupabaseAdminClient();
    // Check if user is verified graduate/student
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_verified')
      .eq('id', req.user.id)
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
    
    // Validate job_id is provided
    if (!job_id) {
      return res.status(400).json({
        error: 'Job ID is required'
      });
    }
    
    // Check if job exists and is active
    const { data: job } = await supabase
      .from('jobs')
      .select('id, status, max_applications, application_count')
      .eq('id', job_id)
      .single();
    
    if (!job || job.status !== 'active') {
      return res.status(404).json({
        error: 'Job not found or not active'
      });
    }
    
    // Check if already applied
    const { data: existing } = await supabase
      .from('applications')
      .select('id')
      .eq('job_id', job_id)
      .eq('applicant_id', req.user.id)
      .single();
    
    if (existing) {
      return res.status(400).json({
        error: 'You have already applied for this job'
      });
    }
    
    // Create application
    const { data: application, error } = await supabase
      .from('applications')
      .insert({
        job_id,
        applicant_id: req.user.id,
        cover_letter: cover_letter || null,
        status: 'pending'
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // Update job application count
    await supabaseAdmin
      .from('jobs')
      .update({ application_count: (job.application_count || 0) + 1 })
      .eq('id', job_id);
    
    return res.status(201).json({ application });
  } catch (error) {
    return res.status(500).json({ error: error.message });
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
      .eq('id', req.user.id)
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

    const farmId = application.jobs?.farm_id;
    if (!farmId || farmId !== req.user.id) {
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
    return res.status(500).json({ error: error.message });
  }
});

// PATCH /api/applications/:id - Update application status
router.patch('/:id', authenticate, async (req, res) => {
  try {
    // Use authenticated client from middleware (req.supabase) or admin client to bypass RLS
    const supabase = req.supabase || getSupabaseClient();
    const supabaseAdmin = getSupabaseAdminClient();
    
    // Use admin client to fetch profile to ensure we can read it regardless of RLS
    console.log('[PATCH /applications/:id] Checking user role for:', req.user.id);
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role, id')
      .eq('id', req.user.id)
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
    
    if (!['farm', 'admin'].includes(profile.role)) {
      console.error('[PATCH /applications/:id] Invalid role:', profile.role, 'for user:', req.user.id);
      return res.status(403).json({
        error: 'Only employers/farms and admins can update application status',
        userRole: profile.role
      });
    }
    
    const { status, review_notes } = req.body;
    
    // Get application to verify farm owns the job - use admin client to bypass RLS
    // Include applicant and job data for email notifications
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
    
    console.log('[PATCH /applications/:id] Application IDs:', {
      id: application.id,
      applicantId: application.applicant_id,
      jobId: application.job_id,
      farmId: application.jobs?.farm_id
    });
    
    // Verify farm owns this job (unless admin)
    if (profile.role === 'farm' && application.jobs.farm_id !== req.user.id) {
      return res.status(403).json({
        error: 'You can only update applications for your own jobs'
      });
    }
    
    // Update application
    const updateData = {
      status,
      reviewed_by: req.user.id,
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
          farm_id: application.jobs.farm_id,
          graduate_id: application.applicant_id,
          status: 'pending'
        })
        .select()
        .single();
      
      if (placementError) throw placementError;
      
      // Create payment record
      await supabaseAdmin
        .from('payments')
        .insert({
          placement_id: placement.id,
          farm_id: application.jobs.farm_id,
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
    
    // Send email notification when application status changes
    // Fetch applicant email if not already in application object
    let applicantEmail = application.applicant?.email;
    if (!applicantEmail && application.applicant_id) {
      const { data: applicantProfile } = await supabaseAdmin
        .from('profiles')
        .select('email, full_name, role')
        .eq('id', application.applicant_id)
        .single();
      
      if (applicantProfile) {
        applicantEmail = applicantProfile.email;
        // Merge applicant data if not already present
        if (!application.applicant) {
          application.applicant = applicantProfile;
        } else {
          application.applicant.email = applicantEmail;
          application.applicant.full_name = application.applicant.full_name || applicantProfile.full_name;
          application.applicant.role = application.applicant.role || applicantProfile.role;
        }
      }
    }
    
    console.log('[PATCH /applications/:id] Email notification check:', {
      applicantEmail,
      status,
      willSend: applicantEmail && ['accepted', 'rejected', 'shortlisted'].includes(status)
    });
    
    if (applicantEmail && ['accepted', 'rejected', 'shortlisted'].includes(status)) {
      try {
        const { sendNotificationEmail } = await import('../services/email-service.js');
        
        // Determine dashboard path based on applicant role
        const getDashboardPath = (role) => {
          switch (role) {
            case 'student': return '/dashboard/student/applications';
            case 'skilled': return '/dashboard/skilled/applications';
            case 'graduate': return '/dashboard/graduate/applications';
            default: return '/dashboard/graduate/applications';
          }
        };
        
        // Get applicant role - try from application object first, then fetch if needed
        let applicantRole = application.applicant?.role;
        if (!applicantRole && application.applicant_id) {
          const { data: applicantProfile } = await supabaseAdmin
            .from('profiles')
            .select('role')
            .eq('id', application.applicant_id)
            .single();
          applicantRole = applicantProfile?.role || 'graduate';
        }
        
        const dashboardPath = getDashboardPath(applicantRole || 'graduate');
        const jobTitle = application.jobs?.title || 'the position';
        const farmName = application.jobs?.profiles?.farm_name || application.jobs?.farm_name || 'the employer';
        const applicantName = application.applicant?.full_name || 'Applicant';
        const safeJobTitle = escapeHtml(jobTitle);
        const safeFarmName = escapeHtml(farmName);
        const safeApplicantName = escapeHtml(applicantName);
        
        let emailSubject = '';
        let emailMessage = '';
        let notificationTitle = '';
        let notificationMessage = '';
        let notificationType = '';
        
        if (status === 'accepted') {
          emailSubject = 'Application Accepted - AgroTalent Hub';
          emailMessage = `
            <p>Congratulations, ${safeApplicantName}!</p>
            <p>We're excited to inform you that your application for <strong>${safeJobTitle}</strong> at <strong>${safeFarmName}</strong> has been <strong>accepted</strong>!</p>
            <p>The employer has reviewed your application and would like to move forward with your placement.</p>
            <p><strong>Next Steps:</strong></p>
            <ul>
              <li>You will receive further instructions about the placement process</li>
              <li>Payment processing will be initiated by the employer</li>
              <li>You can track your placement status in your dashboard</li>
            </ul>
            <p>Log in to your dashboard to view more details and track your placement progress.</p>
          `;
          notificationTitle = 'Application Accepted!';
          notificationMessage = `Your application for ${safeJobTitle} at ${safeFarmName} has been accepted!`;
          notificationType = 'application_accepted';
        } else if (status === 'rejected') {
          emailSubject = 'Application Update - AgroTalent Hub';
          emailMessage = `
            <p>Hello ${safeApplicantName},</p>
            <p>Thank you for your interest in the position of <strong>${safeJobTitle}</strong> at <strong>${safeFarmName}</strong>.</p>
            <p>After careful consideration, we regret to inform you that your application was not selected for this position at this time.</p>
            <p>We encourage you to continue exploring other opportunities on our platform. We have many exciting positions available that may be a great fit for your skills and experience.</p>
            <p>Keep checking your dashboard for new job postings that match your profile.</p>
          `;
          notificationTitle = 'Application Update';
          notificationMessage = `Your application for ${safeJobTitle} at ${safeFarmName} was not selected.`;
          notificationType = 'application_rejected';
        } else if (status === 'shortlisted') {
          emailSubject = 'Application Shortlisted - AgroTalent Hub';
          emailMessage = `
            <p>Hello ${safeApplicantName},</p>
            <p>Great news! Your application for <strong>${safeJobTitle}</strong> at <strong>${safeFarmName}</strong> has been <strong>shortlisted</strong>!</p>
            <p>The employer is interested in your profile and you're one step closer to being selected for this position.</p>
            <p>You may be contacted for further information or an interview. Please keep an eye on your dashboard and email for updates.</p>
            <p>We wish you the best of luck!</p>
          `;
          notificationTitle = 'Application Shortlisted!';
          notificationMessage = `Your application for ${safeJobTitle} at ${safeFarmName} has been shortlisted!`;
          notificationType = 'application_shortlisted';
        }
        
        const emailResult = await sendNotificationEmail(
          application.applicant.email,
          emailSubject,
          emailMessage,
          applicantName,
          {
            role: applicantRole || 'graduate',
            ctaUrl: dashboardPath,
            ctaText: 'View Application'
          }
        );
        
        if (!emailResult.success) {
          console.warn(`Failed to send ${status} email:`, emailResult.error);
        }
        
        // Also create an in-app notification
        await supabaseAdmin
          .from('notifications')
          .insert({
            user_id: application.applicant_id,
            type: notificationType,
            title: notificationTitle,
            message: notificationMessage,
            link: dashboardPath
          });
      } catch (emailError) {
        console.error(`Error sending ${status} email:`, emailError);
        // Don't fail the application update if email fails
      }
    }
    
    return res.json({ application: updated });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
