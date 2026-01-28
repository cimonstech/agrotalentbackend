import { getSupabaseClient, getSupabaseAdminClient, getSupabaseClientWithAuth } from '../lib/supabase.js';

// Middleware to authenticate requests
export const authenticate = async (req, res, next) => {
  try {
    const supabase = getSupabaseClient();
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }
    
    const token = authHeader.split('Bearer ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }
    
    req.user = user;
    req.accessToken = token;
    // Attach an authed supabase client for RLS-protected queries
    req.supabase = getSupabaseClientWithAuth(token);
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

// Middleware to check if user is admin
export const requireAdmin = async (req, res, next) => {
  try {
    // First authenticate the user
    const supabase = getSupabaseClient();
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }
    
    const token = authHeader.split('Bearer ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }
    
    req.user = user;
    req.accessToken = token;
    req.supabase = getSupabaseClientWithAuth(token);
    
    // Then check if user is admin
    const supabaseAdmin = getSupabaseAdminClient();
    
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();
    
    if (error || !profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }
    
    req.profile = profile;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Forbidden' });
  }
};

// Helper to get user from request
export const getUserFromRequest = async (req) => {
  const supabase = getSupabaseClient();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.split('Bearer ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) return null;
  return user;
};
