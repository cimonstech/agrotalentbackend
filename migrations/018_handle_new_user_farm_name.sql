-- Fix: handle_new_user must set farm_name when role = 'farm' to satisfy
-- profiles constraint: (role = 'farm' AND farm_name IS NOT NULL) OR (role != 'farm')
-- This fixes "Database error creating new user" when creating farm users (e.g. ensure-unknown-farm).

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_role TEXT := COALESCE(NEW.raw_user_meta_data->>'role', 'graduate');
  v_full_name TEXT := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_farm_name TEXT := NULL;
  v_institution_name TEXT := NULL;
BEGIN
  IF v_role = 'farm' THEN
    v_farm_name := COALESCE(
      NEW.raw_user_meta_data->>'farm_name',
      NEW.raw_user_meta_data->>'full_name',
      'Unknown'
    );
  ELSIF v_role IN ('graduate', 'student') THEN
    v_institution_name := COALESCE(
      NEW.raw_user_meta_data->>'institution_name',
      'Unknown'
    );
  END IF;

  INSERT INTO public.profiles (id, email, role, full_name, farm_name, institution_name)
  VALUES (
    NEW.id,
    NEW.email,
    v_role,
    v_full_name,
    v_farm_name,
    v_institution_name
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
