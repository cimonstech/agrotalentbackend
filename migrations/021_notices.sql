-- Notices/Announcements: admin posts notices; users see them on Notices page and in notifications.
-- Audience: all | graduate | farm | student (admins are never recipients).

CREATE TABLE IF NOT EXISTS notices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  body_html TEXT NOT NULL,
  link TEXT,
  audience TEXT NOT NULL CHECK (audience IN ('all', 'graduate', 'farm', 'student')),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notices_audience ON notices(audience);
CREATE INDEX IF NOT EXISTS idx_notices_created_at ON notices(created_at DESC);

ALTER TABLE notices ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins can manage notices" ON notices
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Users see notices targeted to their role (or 'all')
CREATE POLICY "Users can view notices for their role" ON notices
  FOR SELECT USING (
    audience = 'all'
    OR audience = (SELECT role FROM profiles WHERE id = auth.uid() LIMIT 1)
  );

-- Optional: track read state per user
CREATE TABLE IF NOT EXISTS notice_reads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  notice_id UUID NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(notice_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notice_reads_user ON notice_reads(user_id);

ALTER TABLE notice_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notice reads" ON notice_reads
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own notice reads" ON notice_reads
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins can view all notice reads" ON notice_reads
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Allow 'notice' and 'training_notice' notification types
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'job_posted', 'application_received', 'application_status', 'match_found',
  'training_scheduled', 'payment_required', 'placement_confirmed', 'notice', 'training_notice'
));

COMMENT ON TABLE notices IS 'Admin-posted notices/announcements; target by role; shown on Notices page and in notifications.';
