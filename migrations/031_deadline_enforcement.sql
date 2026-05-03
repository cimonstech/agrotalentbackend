-- Application deadline enforcement: column + index

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS application_deadline TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS jobs_deadline_enforcement_idx
  ON jobs (status, application_deadline)
  WHERE status = 'active' AND deleted_at IS NULL AND application_deadline IS NOT NULL;
