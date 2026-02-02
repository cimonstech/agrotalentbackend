-- Migration: Fix Supabase Security Lints
-- Addresses function search_path and RLS policy warnings

-- 1. Fix function search_path (security: prevent search_path attacks)
-- Set search_path to empty or specific schemas for all public functions

-- refresh_job_application_count
DROP FUNCTION IF EXISTS public.refresh_job_application_count() CASCADE;
CREATE OR REPLACE FUNCTION public.refresh_job_application_count()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE jobs
  SET application_count = (
    SELECT COUNT(*) FROM applications WHERE job_id = NEW.job_id
  )
  WHERE id = NEW.job_id;
  RETURN NEW;
END;
$$;

-- update_status_changed_at
DROP FUNCTION IF EXISTS public.update_status_changed_at() CASCADE;
CREATE OR REPLACE FUNCTION public.update_status_changed_at()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'inactive' THEN
    NEW.status_changed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- update_updated_at_column
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- calculate_match_score
DROP FUNCTION IF EXISTS public.calculate_match_score(UUID, UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.calculate_match_score(p_graduate_id UUID, p_job_id UUID)
RETURNS INTEGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_score INTEGER := 0;
  v_graduate RECORD;
  v_job RECORD;
BEGIN
  SELECT * INTO v_graduate FROM profiles WHERE id = p_graduate_id;
  SELECT * INTO v_job FROM jobs WHERE id = p_job_id;
  
  IF NOT FOUND THEN RETURN 0; END IF;
  
  -- Qualification match (40 points)
  IF v_job.required_qualification IS NOT NULL AND v_graduate.qualification = v_job.required_qualification THEN
    v_score := v_score + 40;
  END IF;
  
  -- Location match (30 points)
  IF v_job.location IS NOT NULL AND v_graduate.preferred_region = v_job.location THEN
    v_score := v_score + 30;
  END IF;
  
  -- Specialization match (20 points)
  IF v_job.required_specialization IS NOT NULL AND v_graduate.specialization = v_job.required_specialization THEN
    v_score := v_score + 20;
  END IF;
  
  -- Institution type match (10 points)
  IF v_job.required_institution_type IS NOT NULL AND v_graduate.institution_type = v_job.required_institution_type THEN
    v_score := v_score + 10;
  END IF;
  
  RETURN v_score;
END;
$$;

-- auto_calculate_match_score
DROP FUNCTION IF EXISTS public.auto_calculate_match_score() CASCADE;
CREATE OR REPLACE FUNCTION public.auto_calculate_match_score()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.match_score := calculate_match_score(NEW.applicant_id, NEW.job_id);
  RETURN NEW;
END;
$$;

-- create_notification
DROP FUNCTION IF EXISTS public.create_notification(UUID, TEXT, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  INSERT INTO notifications (user_id, type, title, message)
  VALUES (p_user_id, p_type, p_title, p_message)
  RETURNING id INTO v_notification_id;
  
  RETURN v_notification_id;
END;
$$;

-- notify_farm_on_application
DROP FUNCTION IF EXISTS public.notify_farm_on_application() CASCADE;
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
  
  PERFORM create_notification(
    v_farm_id,
    'application',
    'New Application',
    v_applicant_name || ' applied for ' || v_job_title
  );
  
  RETURN NEW;
END;
$$;

-- notify_applicant_on_status_change
DROP FUNCTION IF EXISTS public.notify_applicant_on_status_change() CASCADE;
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
    
    PERFORM create_notification(
      NEW.applicant_id,
      'status_change',
      'Application Status Updated',
      'Your application for ' || v_job_title || ' is now ' || NEW.status
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- handle_new_user
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'graduate'),
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$;

-- update_documents_updated_at
DROP FUNCTION IF EXISTS public.update_documents_updated_at() CASCADE;
CREATE OR REPLACE FUNCTION public.update_documents_updated_at()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 2. Recreate triggers (since we dropped CASCADE)
DROP TRIGGER IF EXISTS refresh_application_count ON applications;
CREATE TRIGGER refresh_application_count
  AFTER INSERT OR DELETE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION refresh_job_application_count();

DROP TRIGGER IF EXISTS update_job_status_changed_at ON jobs;
CREATE TRIGGER update_job_status_changed_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_status_changed_at();

DROP TRIGGER IF EXISTS calculate_match_on_insert ON applications;
CREATE TRIGGER calculate_match_on_insert
  BEFORE INSERT ON applications
  FOR EACH ROW
  EXECUTE FUNCTION auto_calculate_match_score();

DROP TRIGGER IF EXISTS notify_farm_trigger ON applications;
CREATE TRIGGER notify_farm_trigger
  AFTER INSERT ON applications
  FOR EACH ROW
  EXECUTE FUNCTION notify_farm_on_application();

DROP TRIGGER IF EXISTS notify_applicant_trigger ON applications;
CREATE TRIGGER notify_applicant_trigger
  AFTER UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION notify_applicant_on_status_change();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS update_documents_updated_at_trigger ON documents;
CREATE TRIGGER update_documents_updated_at_trigger
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION update_documents_updated_at();

-- 3. RLS: contact_submissions - Keep as is (intentional public INSERT)
-- The lint warns that INSERT is always true, but that's the design: anyone can submit contact form.
-- No change needed; document this as intentional.

-- 4. Note: Leaked password protection
-- This is configured in Supabase Dashboard > Authentication > Policies
-- Enable "Leaked Password Protection" (checks against HaveIBeenPwned) for better security.
-- No SQL change needed; this is an Auth config toggle.

COMMENT ON TABLE contact_submissions IS 'Public contact form - INSERT RLS is intentionally permissive (anyone can submit)';
