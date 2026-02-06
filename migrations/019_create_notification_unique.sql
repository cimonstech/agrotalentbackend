-- Fix: "function create_notification(uuid, unknown, unknown, text) is not unique"
-- Migration 001 created create_notification with 5 params (link optional); 017 created 4-arg version.
-- Both match 4-arg calls. Drop all overloads and keep a single 5-arg function (link optional).

DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_link TEXT DEFAULT NULL
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  INSERT INTO notifications (user_id, type, title, message, link)
  VALUES (p_user_id, p_type, p_title, p_message, p_link)
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$;

-- Recreate trigger functions (CASCADE dropped them when we dropped create_notification)
CREATE OR REPLACE FUNCTION public.notify_farm_on_application()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_farm_id UUID;
  v_applicant_name TEXT;
  v_job_title TEXT;
BEGIN
  SELECT farm_id, title INTO v_farm_id, v_job_title FROM jobs WHERE id = NEW.job_id;
  SELECT full_name INTO v_applicant_name FROM profiles WHERE id = NEW.applicant_id;

  PERFORM public.create_notification(
    v_farm_id,
    'application_received',
    'New Application',
    v_applicant_name || ' applied for ' || v_job_title,
    '/dashboard/farm/jobs/' || NEW.job_id
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_applicant_on_status_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_job_title TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT title INTO v_job_title FROM jobs WHERE id = NEW.job_id;

    PERFORM public.create_notification(
      NEW.applicant_id,
      'application_status',
      'Application Status Updated',
      'Your application for ' || v_job_title || ' is now ' || NEW.status,
      '/dashboard/graduate/applications'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate triggers
DROP TRIGGER IF EXISTS notify_farm_trigger ON applications;
CREATE TRIGGER notify_farm_trigger
  AFTER INSERT ON applications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_farm_on_application();

DROP TRIGGER IF EXISTS notify_applicant_trigger ON applications;
CREATE TRIGGER notify_applicant_trigger
  AFTER UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_applicant_on_status_change();
