import express from 'express';
import { getSupabaseClient } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET /api/profile
router.get('/', authenticate, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { getSupabaseAdminClient } = await import('../lib/supabase.js');
    const supabaseAdmin = getSupabaseAdminClient();
    
    // Try to get profile - use admin client to bypass RLS if needed
    let { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .maybeSingle(); // Use maybeSingle() instead of single() to handle no rows gracefully
    
    // If no profile found, create a basic profile from user metadata
    if (error || !profile) {
      // Check if it's the "no rows" error or profile is null
      if (error?.code === 'PGRST116' || !profile) {
        // Profile doesn't exist - create a basic one from user metadata
        console.log('Profile not found, creating basic profile for user:', req.user.id);
        console.log('User metadata:', JSON.stringify(req.user.user_metadata, null, 2));
        
        // Get role from user metadata or default to 'graduate'
        const role = req.user.user_metadata?.role || 'graduate';
        
        // Build basic profile based on role to satisfy constraints
        const basicProfile = {
          id: req.user.id,
          email: req.user.email || '',
          full_name: req.user.user_metadata?.full_name || null,
          phone: null,
          role: role,
          is_verified: false,
        };
        
        // Add role-specific required fields to satisfy constraints
        if (role === 'farm') {
          // Farm role requires farm_name (from constraint)
          basicProfile.farm_name = req.user.user_metadata?.farm_name || 'Farm Name Pending';
          basicProfile.farm_type = null;
          basicProfile.farm_location = null;
          basicProfile.farm_address = null;
        } else if (role === 'graduate' || role === 'student') {
          // Graduate/Student role requires institution_name (from constraint)
          basicProfile.institution_name = req.user.user_metadata?.institution_name || 'Institution Name Pending';
          basicProfile.institution_type = null;
          basicProfile.qualification = null;
          basicProfile.specialization = null;
          basicProfile.graduation_year = null;
          basicProfile.preferred_region = null;
          if (role === 'student') {
            basicProfile.nss_status = 'not_applicable';
          }
        }
        
        console.log('Attempting to create profile with data:', JSON.stringify(basicProfile, null, 2));
        
        const { data: newProfile, error: createError } = await supabaseAdmin
          .from('profiles')
          .insert(basicProfile)
          .select()
          .maybeSingle();
        
        if (createError) {
          console.error('Failed to create profile - Error details:', {
            message: createError.message,
            code: createError.code,
            details: createError.details,
            hint: createError.hint,
            user_id: req.user.id,
            email: req.user.email,
            role: role
          });
          
          // Try to get more details about the error
          let errorMessage = 'Profile not found and could not be created automatically.';
          if (createError.message) {
            errorMessage += ` ${createError.message}`;
          }
          if (createError.details) {
            errorMessage += ` Details: ${createError.details}`;
          }
          
          return res.status(500).json({ 
            error: errorMessage,
            details: createError.message,
            code: createError.code,
            hint: createError.hint
          });
        }
        
        if (!newProfile) {
          console.error('Profile insert returned no data');
          return res.status(500).json({ 
            error: 'Profile creation returned no data. Please try again or contact support.'
          });
        }
        
        console.log('Profile created successfully:', JSON.stringify(newProfile, null, 2));
        return res.json({ profile: newProfile });
      }
      throw error;
    }
    
    return res.json({ profile });
  } catch (error) {
    console.error('Profile fetch error:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to fetch profile',
      details: error.code || 'Unknown error'
    });
  }
});

// PATCH /api/profile
router.patch('/', authenticate, async (req, res) => {
  try {
    const { getSupabaseAdminClient } = await import('../lib/supabase.js');
    const supabaseAdmin = getSupabaseAdminClient();
    const body = req.body;
    const {
      full_name,
      phone,
      farm_name,
      farm_type,
      farm_location,
      farm_address,
      institution_name,
      institution_type,
      qualification,
      specialization,
      graduation_year,
      preferred_region,
      nss_status
    } = body;
    
    // Get current profile to check role - use admin client to bypass RLS
    const { data: currentProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .maybeSingle();
    
    if (profileError && profileError.code !== 'PGRST116') {
      throw profileError;
    }
    
    if (!currentProfile) {
      return res.status(404).json({ error: 'Profile not found. Please complete your profile setup first.' });
    }
    
    // Build update object based on role
    const updateData = {};
    
    // Common fields
    if (full_name !== undefined) updateData.full_name = full_name;
    if (phone !== undefined) updateData.phone = phone;
    
    // Farm-specific fields
    if (currentProfile.role === 'farm') {
      if (farm_name !== undefined) updateData.farm_name = farm_name;
      if (farm_type !== undefined) updateData.farm_type = farm_type;
      if (farm_location !== undefined) updateData.farm_location = farm_location;
      if (farm_address !== undefined) updateData.farm_address = farm_address;
    }
    
    // Graduate/Student-specific fields
    if (currentProfile.role === 'graduate' || currentProfile.role === 'student') {
      if (institution_name !== undefined) updateData.institution_name = institution_name;
      if (institution_type !== undefined) updateData.institution_type = institution_type;
      if (qualification !== undefined) updateData.qualification = qualification;
      if (specialization !== undefined) updateData.specialization = specialization;
      if (graduation_year !== undefined) updateData.graduation_year = graduation_year;
      if (preferred_region !== undefined) updateData.preferred_region = preferred_region;
      if (currentProfile.role === 'student' && nss_status !== undefined) {
        updateData.nss_status = nss_status;
      }
    }
    
    // Use admin client to update profile (bypasses RLS)
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .update(updateData)
      .eq('id', req.user.id)
      .select()
      .maybeSingle();
    
    if (error) throw error;
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found. Please complete your profile setup first.' });
    }
    
    return res.json({ profile });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/profile/upload-document - Upload document to Cloudflare R2
router.post('/upload-document', authenticate, async (req, res, next) => {
  try {
    const { uploadSingle } = await import('../middleware/upload.js');
    
    // Apply multer middleware
    uploadSingle('file')(req, res, next);
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Failed to process upload'
    });
  }
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { uploadToR2 } = await import('../services/r2-service.js');
    const documentType = req.body.type; // 'certificate', 'transcript', 'cv', 'nss_letter'
    
    if (!['certificate', 'transcript', 'cv', 'nss_letter'].includes(documentType)) {
      return res.status(400).json({
        error: 'Invalid document type'
      });
    }

    // Generate unique filename
    const fileExt = req.file.originalname.split('.').pop();
    const fileName = `${req.user.id}/${documentType}_${Date.now()}.${fileExt}`;

    // Upload to R2
    const publicUrl = await uploadToR2(
      req.file.buffer,
      fileName,
      req.file.mimetype
    );

      // Update profile with document URL
      const supabase = getSupabaseClient();
      const fieldName = `${documentType}_url`;
      const { error: updateError } = await supabase
      .from('profiles')
      .update({ [fieldName]: publicUrl })
      .eq('id', req.user.id);

    if (updateError) throw updateError;

    return res.json({
      url: publicUrl,
      message: 'Document uploaded successfully'
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Failed to upload document'
    });
  }
});

export default router;
