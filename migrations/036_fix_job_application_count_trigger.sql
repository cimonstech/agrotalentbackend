-- Fix jobs.application_count maintenance:
-- 1) Trigger used only NEW.job_id, which is NULL on DELETE — counts never decreased and could desync.
-- 2) Backfill from applications so UI and column match until clients refetch.

CREATE OR REPLACE FUNCTION public.refresh_job_application_count()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  target_job_id UUID;
BEGIN
  target_job_id := COALESCE(NEW.job_id, OLD.job_id);
  IF target_job_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE jobs
  SET application_count = (
    SELECT COUNT(*)::int FROM applications WHERE job_id = target_job_id
  )
  WHERE id = target_job_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS refresh_application_count ON applications;
CREATE TRIGGER refresh_application_count
  AFTER INSERT OR DELETE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION refresh_job_application_count();

UPDATE jobs AS j
SET application_count = COALESCE(
  (SELECT COUNT(*)::int FROM applications a WHERE a.job_id = j.id),
  0
);
