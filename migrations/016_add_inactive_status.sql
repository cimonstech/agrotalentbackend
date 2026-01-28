-- Add 'inactive' status to jobs and add status_changed_at column
-- Inactive jobs older than 24 hours will be hidden from public/graduate portals

-- Add 'inactive' to the status CHECK constraint
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check 
  CHECK (status IN ('draft', 'active', 'paused', 'filled', 'closed', 'inactive'));

-- Add column to track when status was changed to inactive
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

-- Create function to update status_changed_at when status changes
CREATE OR REPLACE FUNCTION update_status_changed_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update status_changed_at if status actually changed
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.status_changed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update status_changed_at
DROP TRIGGER IF EXISTS trigger_update_status_changed_at ON jobs;
CREATE TRIGGER trigger_update_status_changed_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_status_changed_at();

-- Backfill status_changed_at for existing jobs (set to updated_at if status is inactive, otherwise NULL)
UPDATE jobs 
SET status_changed_at = updated_at 
WHERE status = 'inactive' AND status_changed_at IS NULL;
