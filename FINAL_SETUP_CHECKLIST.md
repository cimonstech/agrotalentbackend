# Final Setup Checklist - Complete System

## ✅ Everything Created

### Dashboards: 17/17 ✅
- Admin: 6 pages
- Farm: 8 pages  
- Graduate: 7 pages

### APIs: 25/25 ✅
- Authentication: 6
- Profile: 3
- Admin: 5 (including Super Admin create user)
- Jobs: 2
- Applications: 2
- Other: 7

### Database: Complete ✅
- 11 tables (10 main + 1 contact_submissions)
- All functions and triggers
- RLS policies
- Indexes

## 🚀 Setup Steps for Localhost

### 1. Environment Variables
Create `frontend/.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://aftdnvdkeplbbroeufdt.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_az9ShzA0Bk_GEv_KB-Kjlg_8WWjQ3ul
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
NEXT_PUBLIC_SITE_URL=http://localhost:3000
RESEND_API_KEY=re_E8mxeajE_HvzMLhtM5hbK3ZckXLL5ArpZ
```

**Important:** Get `SUPABASE_SERVICE_ROLE_KEY` from:
- Supabase Dashboard → Settings → API → service_role key

### 2. Database Migrations
Run in Supabase SQL Editor (in order):
1. `backend/migrations/001_initial_schema.sql` - Main schema
2. `backend/migrations/002_contact_submissions.sql` - Contact table

### 3. Storage Buckets
Create in Supabase Storage:
- `certificates`
- `transcripts`
- `cvs`
- `nss-letters`

Set policies (in SQL Editor):
```sql
-- Allow authenticated uploads
CREATE POLICY "Authenticated upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id IN ('certificates', 'transcripts', 'cvs', 'nss-letters')
    AND auth.role() = 'authenticated'
  );

-- Allow users to read own files
CREATE POLICY "Users read own files" ON storage.objects
  FOR SELECT USING (
    bucket_id IN ('certificates', 'transcripts', 'cvs', 'nss-letters')
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
```

### 4. Supabase Email Settings
- Dashboard → Authentication → URL Configuration
- Site URL: `http://localhost:3000`
- Redirect URLs:
  - `http://localhost:3000/verify-email`
  - `http://localhost:3000/reset-password`
  - `http://localhost:3000/**`

### 5. Create Your Admin Account

**Method 1: Via Supabase Dashboard (Easiest)**
1. Sign up at `http://localhost:3000/signup` (choose any role)
2. Supabase Dashboard → Table Editor → profiles
3. Find your user, edit `role` to `admin`
4. Set `is_verified` to `true`
5. Sign in → Access `/dashboard/admin`

**Method 2: Via SQL**
```sql
-- After signing up, run this:
UPDATE profiles 
SET role = 'admin', is_verified = true 
WHERE email = 'your-email@example.com';
```

### 6. Start Development Server
```bash
cd frontend
npm install
npm run dev
```

Visit: http://localhost:3000

## 🎯 Super Admin Features

Once you're signed in as admin:

1. **Create Users:**
   - Go to `/dashboard/admin/users`
   - Click "Create User"
   - Fill form, select role, check "Verified" if needed
   - Creates user instantly (no email verification needed)

2. **Verify Users:**
   - View pending verifications on admin dashboard
   - Click "Verify" to approve users
   - Users can then apply to jobs

3. **Manage Everything:**
   - View all users, placements, reports
   - Contact form submissions
   - System-wide statistics

## ✅ System Ready

- ✅ All dashboards created
- ✅ All APIs implemented
- ✅ Database schema complete
- ✅ Super admin functionality ready
- ✅ Localhost configured
- ✅ Document upload ready
- ✅ Messaging system ready
- ✅ Training system ready

**You're ready to start testing!** 🚀
