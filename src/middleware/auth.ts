import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AdminAuthRequest, AuthRequest } from '../types/auth.js';
import { getSupabaseAdminClient, getSupabaseClient, getSupabaseClientWithAuth } from '../lib/supabase.js';

export const authenticate: RequestHandler = async (req, res, next) => {
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

    const authReq = req as AuthRequest;
    authReq.user = user;
    authReq.accessToken = token;
    authReq.supabase = getSupabaseClientWithAuth(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

export const requireAdmin: RequestHandler = async (req, res, next) => {
  try {
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

    const adminReq = req as AdminAuthRequest;
    adminReq.user = user;
    adminReq.accessToken = token;
    adminReq.supabase = getSupabaseClientWithAuth(token);

    const supabaseAdmin = getSupabaseAdminClient();

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (error || !profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }

    adminReq.profile = profile;
    next();
  } catch {
    return res.status(403).json({ error: 'Forbidden' });
  }
};

export async function getUserFromRequest(req: Request) {
  const supabase = getSupabaseClient();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.split('Bearer ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) return null;
  return user;
}

export const requireAuth = authenticate;

export function requireRole(...allowedRoles: string[]): RequestHandler {
  return async (req, res, next) => {
    try {
      const authReq = req as AuthRequest;
      if (!authReq.user?.id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const supabaseAdmin = getSupabaseAdminClient();
      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', authReq.user.id)
        .single();

      if (error || !profile?.role || !allowedRoles.includes(profile.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    } catch {
      return res.status(403).json({ error: 'Forbidden' });
    }
  };
}
