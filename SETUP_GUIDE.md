# Backend Setup Guide

## Step 1: Database Setup (Supabase)

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy and paste the entire contents of `backend/migrations/001_initial_schema.sql`
4. Click **Run** to execute the migration
5. Verify tables were created by checking the **Table Editor**

## Step 2: Storage Setup (Supabase Storage)

Create storage buckets for document uploads:

1. Go to **Storage** in Supabase dashboard
2. Create these buckets:
   - `certificates` - For degree certificates
   - `transcripts` - For academic transcripts
   - `cvs` - For CV/resume files
   - `nss-letters` - For NSS letters

3. Set bucket policies (in SQL Editor):
```sql
-- Allow authenticated users to upload
CREATE POLICY "Authenticated users can upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id IN ('certificates', 'transcripts', 'cvs', 'nss-letters') AND auth.role() = 'authenticated');

-- Allow users to read their own files
CREATE POLICY "Users can read own files" ON storage.objects
  FOR SELECT USING (bucket_id IN ('certificates', 'transcripts', 'cvs', 'nss-letters'));
```

## Step 3: Environment Variables

Add to `frontend/.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Paystack (for payments)
PAYSTACK_SECRET_KEY=your_paystack_secret_key
PAYSTACK_PUBLIC_KEY=your_paystack_public_key

# Optional: Email/SMS
RESEND_API_KEY=your_resend_key
TERMII_API_KEY=your_termii_key
SMS_SENDER_ID=your_sender_id
```

## Step 4: Test the API

### Test Job Creation (Farm)
```bash
# POST /api/jobs
curl -X POST http://localhost:3000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Farm Manager",
    "description": "Seeking experienced farm manager",
    "job_type": "farm_manager",
    "location": "Kumasi",
    "salary_min": 2000,
    "salary_max": 3500
  }'
```

### Test Application (Graduate)
```bash
# POST /api/applications
curl -X POST http://localhost:3000/api/applications \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "job-uuid-here",
    "cover_letter": "I am interested in this position"
  }'
```

## Step 5: Verify Automation

1. **Create a Farm Profile** → Post a job
2. **Create a Graduate Profile** → Verify them
3. **Graduate Applies** → Check if farm gets notification
4. **Farm Accepts** → Check if placement and payment record created
5. **Check Match Scores** → Verify automatic calculation

## What's Automated

✅ **Match Score Calculation** - Database trigger calculates automatically
✅ **Notifications** - Database triggers send notifications on events
✅ **Application Sorting** - Applications sorted by match score automatically
✅ **Payment Tracking** - Payment records created automatically on placement
✅ **Location Matching** - Only shows jobs in graduate's region

## Next: Build Dashboards

Now you can build the frontend dashboards that use these APIs:
- Farm Dashboard: Post jobs, view applications, accept/reject
- Graduate Dashboard: Browse jobs, apply, view status
- Admin Dashboard: Verify users, manage placements

The backend handles all the automation! 🚀
