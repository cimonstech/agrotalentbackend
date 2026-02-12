-- Fix: application status notification link should include role and application id
-- so "View Details" goes to /dashboard/{role}/applications/{id} instead of 404.

CREATE OR REPLACE FUNCTION public.notify_applicant_on_status_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_job_title TEXT;
  v_applicant_role TEXT;
  v_link TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT title INTO v_job_title FROM jobs WHERE id = NEW.job_id;
    SELECT role INTO v_applicant_role FROM profiles WHERE id = NEW.applicant_id LIMIT 1;
    v_applicant_role := COALESCE(v_applicant_role, 'graduate');
    v_link := '/dashboard/' || v_applicant_role || '/applications/' || NEW.id;

    PERFORM public.create_notification(
      NEW.applicant_id,
      'application_status',
      'Application Status Updated',
      'Your application for ' || v_job_title || ' is now ' || NEW.status,
      v_link
    );
  END IF;

  RETURN NEW;
END;
$$;
