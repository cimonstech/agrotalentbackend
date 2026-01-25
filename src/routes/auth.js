import express from 'express';
import { getSupabaseClient, getSupabaseAdminClient } from '../lib/supabase.js';

const router = express.Router();

// Helper to get user from request (via token)
const getUserFromRequest = async (req, supabaseClient) => {
  const supabase = supabaseClient || getSupabaseClient();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.split('Bearer ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) return null;
  return user;
};

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    console.log('Signup request received:', { 
      email: req.body?.email, 
      role: req.body?.role,
      hasPassword: !!req.body?.password 
    });
    
    const supabase = getSupabaseClient();
    const supabaseAdmin = getSupabaseAdminClient();
    const { email, password, full_name, phone, role, ...roleSpecificData } = req.body;

    // Validate required fields
    if (!email || !password || !role) {
      return res.status(400).json({
        error: 'Email, password, and role are required'
      });
    }

    // Validate role
    if (!['farm', 'graduate', 'student', 'skilled'].includes(role)) {
      return res.status(400).json({
        error: 'Invalid role. Must be farm, graduate, student, or skilled'
      });
    }

    // Validate role-specific fields
    if (role === 'farm' && !roleSpecificData.farm_name) {
      return res.status(400).json({
        error: 'Farm name is required for farm accounts'
      });
    }

    if ((role === 'graduate' || role === 'student') && !roleSpecificData.institution_name) {
      return res.status(400).json({
        error: 'Institution name is required for graduate/student accounts'
      });
    }

    // Create auth user WITHOUT auto-confirming email
    // User must verify email via Resend email before signing in
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: false, // Require email verification
      user_metadata: {
        full_name: full_name || '',
        role,
      },
    });

    if (authError) {
      console.error('Auth signup error:', authError);
      throw authError;
    }

    if (!authData.user) {
      return res.status(500).json({
        error: 'Failed to create user'
      });
    }

    // Create profile with role-specific data
    const profileData = {
      id: authData.user.id,
      email,
      full_name: full_name || null,
      phone: phone || null,
      role,
      is_verified: false,
    };

    // Add farm-specific fields
    if (role === 'farm') {
      profileData.farm_name = roleSpecificData.farm_name;
      profileData.farm_type = roleSpecificData.farm_type || null;
      profileData.farm_location = roleSpecificData.farm_location || null;
      profileData.farm_address = roleSpecificData.farm_address || null;
    }

    // Add graduate/student-specific fields
    if (role === 'graduate' || role === 'student') {
      profileData.institution_name = roleSpecificData.institution_name;
      profileData.institution_type = roleSpecificData.institution_type || null;
      profileData.qualification = roleSpecificData.qualification || null;
      profileData.specialization = roleSpecificData.specialization || null;
      profileData.graduation_year = roleSpecificData.graduation_year || null;
      profileData.preferred_region = roleSpecificData.preferred_region || null;
      
      // Optional experience fields (can be added by graduates/students)
      if (roleSpecificData.years_of_experience) {
        profileData.years_of_experience = roleSpecificData.years_of_experience;
      }
      if (roleSpecificData.experience_description) {
        profileData.experience_description = roleSpecificData.experience_description;
      }
      if (roleSpecificData.crops_experience) {
        profileData.crops_experience = roleSpecificData.crops_experience;
      }
      if (roleSpecificData.livestock_experience) {
        profileData.livestock_experience = roleSpecificData.livestock_experience;
      }
      if (roleSpecificData.skills) {
        profileData.skills = roleSpecificData.skills;
      }
      if (roleSpecificData.previous_employer) {
        profileData.previous_employer = roleSpecificData.previous_employer;
      }
      if (roleSpecificData.reference_name) {
        profileData.reference_name = roleSpecificData.reference_name;
      }
      if (roleSpecificData.reference_phone) {
        profileData.reference_phone = roleSpecificData.reference_phone;
      }
      if (roleSpecificData.reference_relationship) {
        profileData.reference_relationship = roleSpecificData.reference_relationship;
      }
      
      if (role === 'student') {
        profileData.nss_status = roleSpecificData.nss_status || 'not_applicable';
      }
    }

    // Add skilled worker-specific fields
    if (role === 'skilled') {
      profileData.years_of_experience = roleSpecificData.years_of_experience || null;
      profileData.experience_description = roleSpecificData.experience_description || null;
      profileData.crops_experience = roleSpecificData.crops_experience || null;
      profileData.livestock_experience = roleSpecificData.livestock_experience || null;
      profileData.skills = roleSpecificData.skills || null;
      profileData.previous_employer = roleSpecificData.previous_employer || null;
      profileData.reference_name = roleSpecificData.reference_name || null;
      profileData.reference_phone = roleSpecificData.reference_phone || null;
      profileData.reference_relationship = roleSpecificData.reference_relationship || null;
      profileData.preferred_region = roleSpecificData.preferred_region || null;
    }

    // Wait a moment for the trigger to complete
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Log profile data for debugging
    console.log('Creating profile with data:', JSON.stringify(profileData, null, 2));
    
    // Insert or update profile using ADMIN client to bypass RLS
    // The trigger may have created a basic profile, so we upsert with full details
    const { data: profileResult, error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert(profileData, {
        onConflict: 'id',
        ignoreDuplicates: false
      })
      .select()
      .single();

    if (profileError) {
      console.error('Profile creation error:', profileError);
      console.error('Profile data that failed:', JSON.stringify(profileData, null, 2));
      // Return error but don't fail signup - user can update profile later
      return res.status(201).json({
        user: authData.user,
        message: 'Account created successfully, but profile creation failed. Please update your profile in settings.',
        warning: profileError.message,
        requiresEmailVerification: false,
      });
    }

    console.log('Profile created successfully:', JSON.stringify(profileResult, null, 2));

    // Send welcome/verification email via Resend (even though email is auto-confirmed)
    // This is a welcome email that also serves as verification confirmation
    if (authData.user) {
      try {
        const { sendVerificationEmail } = await import('../services/email-service.js');
        
        // Generate a signup verification link
        const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: 'signup',
          email: email,
          options: {
            redirectTo: `${siteUrl}/verify-email`,
          },
        });

        if (!linkError && linkData?.properties?.action_link) {
          // Use the full Supabase verification link (includes all necessary tokens)
          const verificationLink = linkData.properties.action_link;
          
          // Send verification email via Resend with the full link
          const emailResult = await sendVerificationEmail(email, verificationLink, full_name);
          if (!emailResult.success) {
            console.warn('Verification email failed to send:', emailResult.error);
            // Don't fail signup if email fails - user can request resend
          } else {
            console.log('Verification email sent successfully to:', email);
          }
        } else {
          console.warn('Failed to generate verification link:', linkError);
        }
      } catch (emailError) {
        console.error('Failed to send welcome email:', emailError);
        // Don't fail the signup if email fails
      }
    }
    
    return res.status(201).json({
      user: authData.user,
      profile: profileResult,
      message: 'Account created successfully. Please check your email to verify your account before signing in.',
      requiresEmailVerification: true, // Email verification required
    });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to create account'
    });
  }
});

// POST /api/auth/signin
router.post('/signin', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    // Sign in user
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      if (authError.message.includes('Invalid login credentials')) {
        return res.status(401).json({
          error: 'Invalid email or password'
        });
      }
      
      // Check if email is not confirmed
      if (authError.message.includes('Email not confirmed')) {
        // For admin users, bypass email verification requirement
        // First, try to get the user profile to check if they're an admin
        const supabaseAdmin = getSupabaseAdminClient();
        const { data: profileCheck } = await supabaseAdmin
          .from('profiles')
          .select('role')
          .eq('email', email)
          .maybeSingle();
        
        // If user is admin, manually confirm their email and allow sign in
        if (profileCheck?.role === 'admin') {
          console.log('Admin user detected, bypassing email verification:', email);
          
          // Get the user ID from auth
          const { data: userData } = await supabaseAdmin.auth.admin.listUsers();
          const adminUser = userData?.users?.find(u => u.email === email);
          
          if (adminUser) {
            // Update user to confirm email
            await supabaseAdmin.auth.admin.updateUserById(adminUser.id, {
              email_confirm: true
            });
            
            // Retry sign in
            const { data: retryAuthData, error: retryError } = await supabase.auth.signInWithPassword({
              email,
              password,
            });
            
            if (retryError) {
              throw retryError;
            }
            
            // Use the retry auth data
            authData.user = retryAuthData.user;
            authData.session = retryAuthData.session;
          } else {
            return res.status(403).json({
              error: 'Admin account found but could not be verified. Please contact support.'
            });
          }
        } else {
          // Not an admin, require email verification
          return res.status(403).json({
            error: 'Please verify your email before signing in. Check your inbox for the verification link.'
          });
        }
      } else {
        throw authError;
      }
    }

    if (!authData.user) {
      return res.status(500).json({
        error: 'Sign in failed'
      });
    }

    // Get user profile
    const supabaseAdmin = getSupabaseAdminClient();
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (profileError) {
      console.error('Profile fetch error:', profileError);
    }

    return res.json({
      user: authData.user,
      session: authData.session,
      profile: profile || null,
    });
  } catch (error) {
    console.error('Signin error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to sign in'
    });
  }
});

// POST /api/auth/signout
router.post('/signout', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const user = await getUserFromRequest(req, supabase);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    return res.json({ message: 'Signed out successfully' });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Failed to sign out'
    });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required'
      });
    }

    // Generate password reset link using admin client
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: email,
      options: {
        redirectTo: `${siteUrl}/reset-password`, // Redirect to reset password page
      },
    });

    if (linkError) {
      // If user doesn't exist, don't reveal that
      if (linkError.message.includes('User not found')) {
        return res.json({
          message: 'If an account exists with this email, a password reset link has been sent.'
        });
      }
      throw linkError;
    }

    if (!linkData?.properties?.action_link) {
      throw new Error('Failed to generate password reset link');
    }

    // Extract token from the link
    const resetLink = linkData.properties.action_link;
    const url = new URL(resetLink);
    const token = url.searchParams.get('token') || url.hash.split('access_token=')[1]?.split('&')[0];

    // Send password reset email via Resend
    const { sendPasswordResetEmail } = await import('../services/email-service.js');
    
    // Get user's name if available
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('email', email)
      .single();
    
    const fullName = profile?.full_name || '';

    const emailResult = await sendPasswordResetEmail(email, resetLink, fullName);
    
    if (!emailResult.success) {
      console.warn('Password reset email failed to send:', emailResult.error);
      // Still return success to user (security best practice)
      return res.json({
        message: 'If an account exists with this email, a password reset link has been sent.'
      });
    }

    console.log('Password reset email sent successfully to:', email);

    return res.json({
      message: 'If an account exists with this email, a password reset link has been sent. Please check your inbox.'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to send password reset email'
    });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { password, token } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters'
      });
    }

    // If token is provided, use it to set session first
    if (token) {
      // Exchange token for session
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token: token,
        refresh_token: '', // Not needed for password reset
      });

      if (sessionError) {
        return res.status(401).json({
          error: 'Invalid or expired reset token. Please request a new password reset.'
        });
      }
    } else {
      // Try to get user from request (if already authenticated via URL hash)
      const user = await getUserFromRequest(req, supabase);
      if (!user) {
        return res.status(401).json({
          error: 'Invalid or expired reset link. Please request a new password reset.'
        });
      }
    }

    // Update password
    const { data, error } = await supabase.auth.updateUser({
      password,
    });

    if (error) throw error;

    return res.json({
      message: 'Password reset successfully. You can now sign in with your new password.',
      user: data.user,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Failed to reset password'
    });
  }
});

// POST /api/auth/verify-email
router.post('/verify-email', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required'
      });
    }

    // Generate verification link using admin client
    const supabaseAdmin = getSupabaseAdminClient();
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'signup',
      email: email,
      options: {
        redirectTo: `${siteUrl}/verify-email`,
      },
    });

    if (linkError) {
      if (linkError.message.includes('already verified')) {
        return res.json({
          message: 'Your email is already verified. You can sign in.'
        });
      }
      throw linkError;
    }

    // Send email via Resend
    const { sendVerificationEmail } = await import('../services/email-service.js');
    const verificationLink = linkData.properties.action_link;
    const tokenMatch = verificationLink.match(/token=([^&]+)/);
    const token = tokenMatch ? tokenMatch[1] : verificationLink;
    
    const emailResult = await sendVerificationEmail(email, token);
    
    if (!emailResult.success) {
      console.warn('Failed to send verification email:', emailResult.error);
      // Don't throw - user can still verify via Supabase's default email
      return res.json({
        message: 'Verification link generated. Please check your email or try again later.',
        warning: emailResult.error
      });
    }

    return res.json({
      message: 'Verification email sent. Please check your inbox.',
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Failed to send verification email'
    });
  }
});

export default router;
