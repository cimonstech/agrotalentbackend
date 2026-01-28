-- Enforce RLS so users only access their own data
-- Assumptions:
-- - Active jobs remain publicly readable (needed for public job listings)
-- - Admins retain full access for admin features

-- Enable RLS for tables missing it
ALTER TABLE training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- ============================
-- PROFILES
-- ============================
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- ============================
-- JOBS
-- ============================
DROP POLICY IF EXISTS "Admins can manage all jobs" ON jobs;
CREATE POLICY "Admins can manage all jobs" ON jobs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- ============================
-- APPLICATIONS
-- ============================
DROP POLICY IF EXISTS "Admins can manage all applications" ON applications;
CREATE POLICY "Admins can manage all applications" ON applications
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Farms can update applications for their jobs" ON applications;
CREATE POLICY "Farms can update applications for their jobs" ON applications
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM jobs
      WHERE jobs.id = applications.job_id
      AND jobs.farm_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM jobs
      WHERE jobs.id = applications.job_id
      AND jobs.farm_id = auth.uid()
    )
  );

-- ============================
-- PLACEMENTS
-- ============================
DROP POLICY IF EXISTS "Admins can manage all placements" ON placements;
CREATE POLICY "Admins can manage all placements" ON placements
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Farms can view own placements" ON placements;
CREATE POLICY "Farms can view own placements" ON placements
  FOR SELECT USING (farm_id = auth.uid());

DROP POLICY IF EXISTS "Farms can update own placements" ON placements;
CREATE POLICY "Farms can update own placements" ON placements
  FOR UPDATE USING (farm_id = auth.uid())
  WITH CHECK (farm_id = auth.uid());

DROP POLICY IF EXISTS "Graduates can view own placements" ON placements;
CREATE POLICY "Graduates can view own placements" ON placements
  FOR SELECT USING (graduate_id = auth.uid());

-- ============================
-- NOTIFICATIONS
-- ============================
DROP POLICY IF EXISTS "Admins can view all notifications" ON notifications;
CREATE POLICY "Admins can view all notifications" ON notifications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- ============================
-- CONVERSATIONS
-- ============================
DROP POLICY IF EXISTS "Participants can view own conversations" ON conversations;
CREATE POLICY "Participants can view own conversations" ON conversations
  FOR SELECT USING (farm_id = auth.uid() OR graduate_id = auth.uid());

DROP POLICY IF EXISTS "Participants can create conversations" ON conversations;
CREATE POLICY "Participants can create conversations" ON conversations
  FOR INSERT WITH CHECK (farm_id = auth.uid() OR graduate_id = auth.uid());

DROP POLICY IF EXISTS "Participants can update conversations" ON conversations;
CREATE POLICY "Participants can update conversations" ON conversations
  FOR UPDATE USING (farm_id = auth.uid() OR graduate_id = auth.uid())
  WITH CHECK (farm_id = auth.uid() OR graduate_id = auth.uid());

DROP POLICY IF EXISTS "Admins can manage conversations" ON conversations;
CREATE POLICY "Admins can manage conversations" ON conversations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- ============================
-- MESSAGES
-- ============================
DROP POLICY IF EXISTS "Participants can view messages in their conversations" ON messages;
CREATE POLICY "Participants can view messages in their conversations" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND (conversations.farm_id = auth.uid() OR conversations.graduate_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Participants can send messages" ON messages;
CREATE POLICY "Participants can send messages" ON messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND (conversations.farm_id = auth.uid() OR conversations.graduate_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Participants can update messages" ON messages;
CREATE POLICY "Participants can update messages" ON messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND (conversations.farm_id = auth.uid() OR conversations.graduate_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND (conversations.farm_id = auth.uid() OR conversations.graduate_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Senders can delete their own messages" ON messages;
CREATE POLICY "Senders can delete their own messages" ON messages
  FOR DELETE USING (sender_id = auth.uid());

-- ============================
-- TRAINING SESSIONS
-- ============================
DROP POLICY IF EXISTS "Admins can manage training sessions" ON training_sessions;
CREATE POLICY "Admins can manage training sessions" ON training_sessions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Participants can view assigned training sessions" ON training_sessions;
CREATE POLICY "Participants can view assigned training sessions" ON training_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM training_participants
      WHERE training_participants.session_id = training_sessions.id
      AND training_participants.participant_id = auth.uid()
    )
  );

-- ============================
-- TRAINING ATTENDANCE
-- ============================
DROP POLICY IF EXISTS "Admins can manage training attendance" ON training_attendance;
CREATE POLICY "Admins can manage training attendance" ON training_attendance
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Participants can view own training attendance" ON training_attendance;
CREATE POLICY "Participants can view own training attendance" ON training_attendance
  FOR SELECT USING (participant_id = auth.uid());

-- ============================
-- PAYMENTS
-- ============================
DROP POLICY IF EXISTS "Admins can manage payments" ON payments;
CREATE POLICY "Admins can manage payments" ON payments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Farms can view own payments" ON payments;
CREATE POLICY "Farms can view own payments" ON payments
  FOR SELECT USING (farm_id = auth.uid());
