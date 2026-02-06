-- Fix: notification type must be one of the allowed values (notifications_type_check).
-- Use 'application_received' and 'application_status' instead of 'application' and 'status_change'.
-- Run this if 019 was already applied with the wrong types.

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
