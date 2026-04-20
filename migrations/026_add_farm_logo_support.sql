-- Add farm/employer logo support for job cards and profile settings.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS farm_logo_url TEXT;

-- Create public bucket for square-cropped farm logos.
INSERT INTO storage.buckets (id, name, public)
VALUES ('farm-logos', 'farm-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Public read access for logos.
DROP POLICY IF EXISTS "farm_logos_public_read" ON storage.objects;
CREATE POLICY "farm_logos_public_read"
ON storage.objects
FOR SELECT
USING (bucket_id = 'farm-logos');

-- Authenticated users can upload logos into their own folder: <uid>/logo_*.jpg
DROP POLICY IF EXISTS "farm_logos_auth_upload_own" ON storage.objects;
CREATE POLICY "farm_logos_auth_upload_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'farm-logos'
  AND split_part(name, '/', 1) = auth.uid()::text
);

DROP POLICY IF EXISTS "farm_logos_auth_update_own" ON storage.objects;
CREATE POLICY "farm_logos_auth_update_own"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'farm-logos'
  AND split_part(name, '/', 1) = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'farm-logos'
  AND split_part(name, '/', 1) = auth.uid()::text
);

DROP POLICY IF EXISTS "farm_logos_auth_delete_own" ON storage.objects;
CREATE POLICY "farm_logos_auth_delete_own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'farm-logos'
  AND split_part(name, '/', 1) = auth.uid()::text
);

