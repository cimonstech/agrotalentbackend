-- Allow admins (JWT) to insert/update communication logs from the dashboard if needed.
-- Primary path uses the service role API; this avoids RLS errors for direct client writes.

DROP POLICY IF EXISTS "Admins can insert communication logs" ON communication_logs;
CREATE POLICY "Admins can insert communication logs" ON communication_logs
  FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update communication logs" ON communication_logs;
CREATE POLICY "Admins can update communication logs" ON communication_logs
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
