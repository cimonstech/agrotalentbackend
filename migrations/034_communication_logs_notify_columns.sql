-- Extend communication_logs for automated notify logging (backend/src/lib/logCommunication.ts)

ALTER TABLE communication_logs
  ADD COLUMN IF NOT EXISTS channel TEXT,
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS recipient_email TEXT,
  ADD COLUMN IF NOT EXISTS recipient_phone TEXT,
  ADD COLUMN IF NOT EXISTS related_job_id UUID,
  ADD COLUMN IF NOT EXISTS related_user_id UUID,
  ADD COLUMN IF NOT EXISTS triggered_by TEXT;
