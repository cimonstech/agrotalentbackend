# Quick Start Guide

## Step 1: Install Backend Dependencies

```bash
cd backend
npm install
```

## Step 2: Configure Environment Variables

Create `backend/.env` file:

```env
# Supabase
SUPABASE_URL=https://aftdnvdkeplbbroeufdt.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://aftdnvdkeplbbroeufdt.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_az9ShzA0Bk_GEv_KB-Kjlg_8WWjQ3ul
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Server
PORT=3001
FRONTEND_URL=http://localhost:3000
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Resend
RESEND_API_KEY=your_resend_api_key_here

# Cloudflare R2 (for file storage)
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=agrotalent-documents
R2_PUBLIC_URL=https://your-custom-domain.com  # Optional
```

## Step 3: Set Up Cloudflare R2

1. **Create R2 Bucket:**
   - Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → R2
   - Create bucket: `agrotalent-documents`

2. **Create API Token:**
   - R2 → Manage R2 API Tokens → Create API Token
   - Permissions: Object Read & Write
   - Copy Access Key ID and Secret Access Key
   - Token value: <your_token_value>
   - Access Key ID: <your_access_key_id>
   - Secret Access Key: <your_secret_access_key>



3. **Get Endpoint:**
   - Format: `https://<account-id>.r2.cloudflarestorage.com`
   - Find account ID in Cloudflare Dashboard
   

4. **Add to `.env`:**
   ```env
   R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
   R2_ACCESS_KEY_ID=your_key_here
   R2_SECRET_ACCESS_KEY=your_secret_here
   R2_BUCKET_NAME=agrotalent-documents
   ```

See `CLOUDFLARE_R2_SETUP.md` for detailed instructions.

## Step 4: Start Backend Server

```bash
cd backend
npm run dev
```

Backend will run on `http://localhost:3001`

## Step 5: Configure Frontend

Add to `frontend/.env.local`:

```env
# Backend API URL
NEXT_PUBLIC_API_URL=http://localhost:3000

# Keep existing Supabase vars...
```

**Note:** The Next.js proxy will forward `/api/*` to `http://localhost:3001/api/*` automatically.

## Step 6: Start Frontend

```bash
cd frontend
npm run dev
```

Frontend will run on `http://localhost:3000`

## Step 7: Test

1. **Backend Health:**
   ```bash
   curl http://localhost:3001/health
   ```

2. **Test API:**
   ```bash
   curl http://localhost:3001/api/stats
   ```

3. **Frontend:**
   - Visit http://localhost:3000
   - Try signing up, signing in, etc.

## Troubleshooting

### Backend won't start
- Check `.env` file exists and has all required variables
- Verify R2 credentials are correct
- Check port 3001 is not in use

### File upload fails
- Verify R2 bucket exists and is accessible
- Check R2 API token permissions
- Verify `R2_BUCKET_NAME` matches your bucket name

### Frontend can't connect to backend
- Ensure backend is running on port 3001
- Check `NEXT_PUBLIC_API_URL` in frontend `.env.local`
- Verify CORS settings in backend allow `http://localhost:3000`

## Next Steps

- ✅ Backend running
- ✅ Frontend running
- ✅ R2 configured
- ⏳ Test all endpoints
- ⏳ Update frontend components to use API client (optional)
