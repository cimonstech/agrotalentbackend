-- Training Management (Sessions + Participant assignment + Attendance proof)
-- Adds the "control + proof" layer (training_participants) and extends training_sessions.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Extend existing training_sessions table with MVP fields
ALTER TABLE training_sessions
  ADD COLUMN IF NOT EXISTS category TEXT CHECK (category IN ('graduate', 'worker', 'manager')),
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS trainer_name TEXT,
  ADD COLUMN IF NOT EXISTS trainer_type TEXT CHECK (trainer_type IN ('admin', 'external')),
  ADD COLUMN IF NOT EXISTS attendance_method TEXT CHECK (attendance_method IN ('manual', 'auto')) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('scheduled', 'completed', 'cancelled')) DEFAULT 'scheduled';

-- Participants assigned to a training (also stores manual attendance status)
CREATE TABLE IF NOT EXISTS training_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES profiles(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),

  -- Manual attendance
  attendance_status TEXT CHECK (attendance_status IN ('present', 'absent', 'late')) DEFAULT NULL,
  checked_in_at TIMESTAMPTZ,
  notes TEXT,

  UNIQUE(session_id, participant_id)
);

ALTER TABLE training_participants ENABLE ROW LEVEL SECURITY;

-- Admins can manage participants
CREATE POLICY "Admins can manage training participants" ON training_participants
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Participants can view their own assigned trainings
CREATE POLICY "Participants can view their training assignments" ON training_participants
  FOR SELECT USING (participant_id = auth.uid());

