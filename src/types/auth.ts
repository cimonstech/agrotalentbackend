import type { Request } from 'express';
import type { SupabaseClient, User } from '@supabase/supabase-js';

export interface AuthRequestUser {
  id: string;
  email: string;
  role: string;
}

export interface AuthRequest extends Request {
  user: User;
  accessToken: string;
  supabase: SupabaseClient;
}

export interface AdminAuthRequest extends AuthRequest {
  profile: { role: string };
}
