import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AdminAuthRequest, AuthRequest } from '../types/auth.js';
import { getSupabaseAdminClient, getSupabaseClient, getSupabaseClientWithAuth } from '../lib/supabase.js';

function isSupabaseNetworkTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const anyErr = err as Error & { cause?: unknown; code?: string };
  const cause = anyErr.cause as { code?: string } | undefined;
  return (
    anyErr.message.toLowerCase().includes('fetch failed') ||
    anyErr.code === 'UND_ERR_CONNECT_TIMEOUT' ||
    cause?.code === 'UND_ERR_CONNECT_TIMEOUT'
  );
}

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
  } catch (err) {
    if (isSupabaseNetworkTimeoutError(err)) {
      return res.status(503).json({ error: 'Authentication service unavailable. Please try again.' });
    }
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
  } catch (err) {
    if (isSupabaseNetworkTimeoutError(err)) {
      return res.status(503).json({ error: 'Authentication service unavailable. Please try again.' });
    }
    return res.status(403).json({ error: 'Forbidden' });
  }
};

export async function getUserFromRequest(req: Request) {
  try {
    const supabase = getSupabaseClient();
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.split('Bearer ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
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
