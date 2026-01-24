-- Migration: 008_update_admin_role.sql
-- Quick fix: Update specific user to admin role
-- Replace 'agrotalenthub@gmail.com' with your actual email

-- Update profile role to admin
UPDATE profiles
SET role = 'admin', is_verified = true
WHERE email = 'agrotalenthub@gmail.com';

-- Also update user metadata in auth.users (optional, but recommended)
UPDATE auth.users
SET raw_user_meta_data = jsonb_set(
  COALESCE(raw_user_meta_data, '{}'::jsonb),
  '{role}',
  '"admin"'
)
WHERE email = 'agrotalenthub@gmail.com';

-- Verify the update
SELECT 
  u.id,
  u.email,
  u.email_confirmed_at,
  u.raw_user_meta_data->>'role' as auth_role,
  p.role as profile_role,
  p.is_verified
FROM auth.users u
LEFT JOIN profiles p ON u.id = p.id
WHERE u.email = 'agrotalenthub@gmail.com';
