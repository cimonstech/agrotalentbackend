import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthRequest } from '../types/auth.js';
import { getSupabaseAdminClient, getSupabaseClient, getSupabaseClientWithAuth } from '../lib/supabase.js';

async function getUserWithRetry(
  supabase: ReturnType<typeof getSupabaseClient>,
  token: string,
  maxRetries = 3
) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await supabase.auth.getUser(token);
      return result;
    } catch (err) {
      lastError = err;
      const isNetworkError =
        err instanceof Error &&
        (err.message.includes('ECONNRESET') ||
          err.message.includes('fetch failed') ||
          err.message.includes('ETIMEDOUT') ||
          err.message.includes('ECONNREFUSED'));
      if (isNetworkError && attempt < maxRetries) {
        console.warn(
          '[Auth] Network error on attempt',
          attempt,
          ', retrying in',
          attempt * 300,
          'ms'
        );
        await new Promise((resolve) => setTimeout(resolve, attempt * 300));
        continue;
      }
      break;
    }
  }

  throw lastError;
}

export const authenticate: RequestHandler = async (req, res, next) => {
  const supabase = getSupabaseClient();
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const {
      data: { user },
      error,
    } = await getUserWithRetry(supabase, token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const authReq = req as AuthRequest;
    authReq.user = user as AuthRequest['user']
    authReq.accessToken = token;
    authReq.supabase = getSupabaseClientWithAuth(token);

    try {
      const supabaseAdmin = getSupabaseAdminClient()
      const { data: profileRow } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      if ((profileRow as { role?: string | null } | null)?.role) {
        authReq.user.role = (profileRow as { role: string }).role
      }
    } catch {
      // Non-critical: allow downstream requireAdmin/requireRole to handle missing role
    }

    next();
  } catch (err) {
    console.error(
      '[Auth] Failed after retries:',
      err instanceof Error ? err.message : err
    );
    return res.status(401).json({
      error: 'Authentication service unavailable. Please try again.',
    });
  }
};

export const requireAdmin: RequestHandler = async (req, res, next) => {
  const authReq = req as AuthRequest
  if (!authReq.user) {
    res.status(401).json({ error: 'Unauthorised' })
    return
  }
  if (authReq.user.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  next()
}

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
};

export const requireAuth = authenticate;

export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthRequest
    if (!authReq.user) {
      res.status(401).json({ error: 'Unauthorised' })
      return
    }
    if (authReq.user.role !== role) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    next()
  }
}
