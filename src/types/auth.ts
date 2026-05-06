import type { Request } from 'express';
import type { SupabaseClient, User } from '@supabase/supabase-js';

export type AuthRequestUser = User & { role?: string }

export interface AuthRequest extends Request {
  user: AuthRequestUser;
  accessToken: string;
  supabase: SupabaseClient;
}

export interface AdminAuthRequest extends AuthRequest {
  profile?: { role: string };
}
