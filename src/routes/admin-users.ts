import crypto from 'crypto'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { Router } from 'express'
import { getSupabaseClient, getSupabaseAdminClient } from '../lib/supabase.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import type { AdminAuthRequest } from '../types/auth.js'
import { queryParamToString } from '../lib/query.js'
import { errorMessage } from '../lib/errors.js'
import { validate } from '../lib/validate.js'
import { createUserSchema, verifyUserSchema } from '../lib/schemas.js'
import { fireAndForget } from '../lib/notify.js'

const router = Router()

// GET /api/admin/users - List all users
router.get('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    // Use admin client to bypass RLS and see all users
    const supabaseAdmin = getSupabaseAdminClient();
    const roleParam = queryParamToString(req.query.role);
    const verifiedParam = queryParamToString(req.query.verified);
    const searchParam = queryParamToString(req.query.search);
    const page = parseInt(queryParamToString(req.query.page) || '1', 10);
    const limit = parseInt(queryParamToString(req.query.limit) || '50', 10);
    const offset = (page - 1) * limit;
    
    let query = supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });
    
    if (roleParam) {
      query = query.eq('role', roleParam);
    }
    
    if (verifiedParam === 'true' || verifiedParam === 'false') {
      query = query.eq('is_verified', verifiedParam === 'true');
    }
    
    if (searchParam) {
      query = query.or(`full_name.ilike.%${searchParam}%,email.ilike.%${searchParam}%,farm_name.ilike.%${searchParam}%,institution_name.ilike.%${searchParam}%`);
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
    return res.status(500).json({ error: errorMessage(error) || 'Failed to fetch users' });
  }
});

// GET /api/admin/users/:id - Get single user details
router.get('/users/:id', authenticate, requireAdmin, async (req, res) => {
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
    return res.status(500).json({ error: errorMessage(error) || 'Failed to fetch user details' });
  }
});

// POST /api/admin/users/create - Create user
router.post('/users/create', authenticate, requireAdmin, validate(createUserSchema), async (req, res) => {
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

    const userMetadata: Record<string, unknown> = { full_name: full_name || '', role };
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

    const profileUpdate: Record<string, unknown> = {
      full_name: full_name || null,
      phone: phone || null,
      is_verified: is_verified || false,
    };

    if (is_verified) {
      profileUpdate.verified_at = new Date().toISOString();
      profileUpdate.verified_by = (req as AdminAuthRequest).user.id;
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
      error: errorMessage(error) || 'Failed to create user'
    });
  }
});

// POST /api/admin/ensure-unknown-farm - Get or create the "Farm (unknown)" placeholder for admin job posting
const UNKNOWN_FARM_EMAIL = 'unknown-farm@system.agrotalenthub.internal';
router.post('/ensure-unknown-farm', authenticate, requireAdmin, async (req, res) => {
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
    return res.status(500).json({ error: errorMessage(error) || 'Failed to ensure unknown farm' });
  }
});

// POST /api/admin/verify/:id - Verify user
router.post('/verify/:id', authenticate, requireAdmin, validate(verifyUserSchema), async (req, res) => {
  try {
    // Use admin client to bypass RLS
    const supabaseAdmin = getSupabaseAdminClient();
    const { verified, notes } = req.body;
    
    const updateData = {
      is_verified: verified !== undefined ? verified : true,
      verified_at: verified !== undefined && verified ? new Date().toISOString() : null,
      verified_by: verified !== undefined && verified ? (req as AdminAuthRequest).user.id : null
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
      const dashboardPathForRole = (role: string) => {
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
      fireAndForget(
        async () => {
          const { sendNotificationEmail } = await import('../services/email-service.js')
          const emailResult = await sendNotificationEmail(
            updatedProfile.email,
            'Profile Verified - AgroTalent Hub',
            `Great news! Your profile has been verified by our admin team. You can now:\n\n- Browse and apply to job opportunities\n- Receive job match notifications\n- Connect with employers directly\n\nClick the button below to continue.`,
            updatedProfile.full_name || '',
            { role: updatedProfile.role, ctaUrl: dashboardPath, ctaText: 'Open Dashboard' }
          )
          if (!emailResult.success) {
            throw new Error(emailResult.error || 'Failed to send verification email')
          }
        },
        'admin-user-verified-email',
        {
          event_type: 'user_verified',
          channel: 'email',
          recipient_email: updatedProfile.email,
          subject: 'Profile Verified - AgroTalent Hub',
          message: 'User verification email sent',
          related_user_id: req.params.id,
          triggered_by: 'admin',
        }
      )
    }
    
    return res.json({
      profile: updatedProfile,
      message: verified ? 'Profile verified successfully' : 'Verification removed'
    });
  } catch (error) {
    console.error('Admin verify error:', error);
    return res.status(500).json({ error: errorMessage(error) || 'Failed to verify user' });
  }
});

export default router

