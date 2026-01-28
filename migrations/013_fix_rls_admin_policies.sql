-- Fix RLS recursion by using a SECURITY DEFINER admin check

-- Admin helper (bypasses RLS on profiles)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

-- ============================
-- PROFILES
-- ============================
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING (public.is_admin());

-- ============================
-- JOBS
-- ============================
DROP POLICY IF EXISTS "Admins can manage all jobs" ON jobs;
CREATE POLICY "Admins can manage all jobs" ON jobs
  FOR ALL USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================
-- APPLICATIONS
-- ============================
DROP POLICY IF EXISTS "Admins can manage all applications" ON applications;
CREATE POLICY "Admins can manage all applications" ON applications
  FOR ALL USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================
-- PLACEMENTS
-- ============================
DROP POLICY IF EXISTS "Admins can manage all placements" ON placements;
CREATE POLICY "Admins can manage all placements" ON placements
  FOR ALL USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================
-- NOTIFICATIONS
-- ============================
DROP POLICY IF EXISTS "Admins can view all notifications" ON notifications;
CREATE POLICY "Admins can view all notifications" ON notifications
  FOR SELECT USING (public.is_admin());

-- ============================
-- CONVERSATIONS
-- ============================
DROP POLICY IF EXISTS "Admins can manage conversations" ON conversations;
CREATE POLICY "Admins can manage conversations" ON conversations
  FOR ALL USING (public.is_admin());

-- ============================
-- MESSAGES
-- ============================
DROP POLICY IF EXISTS "Admins can manage messages" ON messages;
CREATE POLICY "Admins can manage messages" ON messages
  FOR ALL USING (public.is_admin());

-- ============================
-- TRAINING SESSIONS
-- ============================
DROP POLICY IF EXISTS "Admins can manage training sessions" ON training_sessions;
CREATE POLICY "Admins can manage training sessions" ON training_sessions
  FOR ALL USING (public.is_admin());

-- ============================
-- TRAINING ATTENDANCE
-- ============================
DROP POLICY IF EXISTS "Admins can manage training attendance" ON training_attendance;
CREATE POLICY "Admins can manage training attendance" ON training_attendance
  FOR ALL USING (public.is_admin());

-- ============================
-- PAYMENTS
-- ============================
DROP POLICY IF EXISTS "Admins can manage payments" ON payments;
CREATE POLICY "Admins can manage payments" ON payments
  FOR ALL USING (public.is_admin())
  WITH CHECK (public.is_admin());
