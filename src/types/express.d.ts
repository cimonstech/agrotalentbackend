import 'express';
import type { User } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
    accessToken?: string;
    supabase?: SupabaseClient;
    profile?: { role: string };
  }
}

export {};
