-- Backfill jobs.application_count and keep it in sync

-- Backfill existing counts
UPDATE jobs
SET application_count = sub.count
FROM (
  SELECT job_id, COUNT(*)::int AS count
  FROM applications
  GROUP BY job_id
) AS sub
WHERE jobs.id = sub.job_id;

-- Set zero for jobs with no applications
UPDATE jobs
SET application_count = 0
WHERE application_count IS NULL;

-- Keep counts in sync going forward
CREATE OR REPLACE FUNCTION public.refresh_job_application_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE jobs
  SET application_count = (
    SELECT COUNT(*)::int FROM applications WHERE job_id = COALESCE(NEW.job_id, OLD.job_id)
  )
  WHERE id = COALESCE(NEW.job_id, OLD.job_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_refresh_job_application_count_insert ON applications;
DROP TRIGGER IF EXISTS trg_refresh_job_application_count_delete ON applications;

CREATE TRIGGER trg_refresh_job_application_count_insert
AFTER INSERT ON applications
FOR EACH ROW EXECUTE FUNCTION public.refresh_job_application_count();

CREATE TRIGGER trg_refresh_job_application_count_delete
AFTER DELETE ON applications
FOR EACH ROW EXECUTE FUNCTION public.refresh_job_application_count();
