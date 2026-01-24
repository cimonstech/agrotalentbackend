-- Add communication logs table for admin bulk/single messaging

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS communication_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL CHECK (type IN ('email', 'sms')),
  recipients TEXT NOT NULL, -- all | farms | graduates | students | single
  subject TEXT,
  message TEXT NOT NULL,
  recipient_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  error_details JSONB,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS (optional, but safe)
ALTER TABLE communication_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view logs (uses profiles.role)
CREATE POLICY "Admins can view communication logs" ON communication_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

