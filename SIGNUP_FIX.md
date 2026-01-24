# Fixing Signup Database Error

## Problem
"Database error saving new user" occurs during signup because:
1. The `handle_new_user` trigger tries to create a profile
2. RLS policies might block the trigger
3. The trigger might fail silently, causing auth signup to fail

## Solution

### Step 1: Run the Migration
Run this SQL in your Supabase SQL Editor:

```sql
-- File: backend/migrations/004_fix_signup_trigger.sql
```

This will:
- Update the trigger function with better error handling
- Ensure the trigger doesn't fail the user creation
- Add the INSERT policy if it doesn't exist

### Step 2: Verify RLS Policies

Check that these policies exist on the `profiles` table:

```sql
-- Should allow users to insert their own profile
SELECT * FROM pg_policies WHERE tablename = 'profiles';
```

### Step 3: Test Signup

After running the migration, test signup again. The trigger will:
1. Create a basic profile automatically
2. The API route will then update it with full details
3. If the update fails, the user still exists and can update later

## Alternative: Disable Trigger (Not Recommended)

If the trigger continues to cause issues, you can disable it:

```sql
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
```

Then the API route will handle all profile creation. However, this means profiles won't be created automatically for users created outside the API.

## Current Behavior

1. User signs up → `supabase.auth.signUp()` called
2. Trigger fires → Creates basic profile (id, email, role, full_name)
3. API route updates → Adds all role-specific fields
4. If update fails → User still exists, can update profile later
