-- Migration: 007_confirm_admin_email.sql
-- This script confirms the email for admin users in auth.users table
-- Run this in Supabase SQL Editor after creating an admin user

-- Replace 'your-admin-email@example.com' with your actual admin email
-- Note: confirmed_at is a generated column, so we only update email_confirmed_at
UPDATE auth.users
SET email_confirmed_at = NOW()
WHERE email = 'your-admin-email@example.com'
  AND email_confirmed_at IS NULL;

-- IMPORTANT: Also update the profile role to 'admin'
UPDATE profiles
SET role = 'admin', is_verified = true
WHERE email = 'your-admin-email@example.com';

-- Verify the update
SELECT 
  u.id,
  u.email,
  u.email_confirmed_at,
  u.confirmed_at, -- This will be automatically set when email_confirmed_at is set
  u.raw_user_meta_data->>'role' as auth_role,
  p.role as profile_role,
  p.is_verified
FROM auth.users u
LEFT JOIN profiles p ON u.id = p.id
WHERE u.email = 'your-admin-email@example.com';

-- Alternative: Confirm email for ALL admin users
-- (Use this if you have multiple admin users)
UPDATE auth.users
SET email_confirmed_at = NOW()
WHERE id IN (
  SELECT id FROM profiles WHERE role = 'admin'
)
AND email_confirmed_at IS NULL;
