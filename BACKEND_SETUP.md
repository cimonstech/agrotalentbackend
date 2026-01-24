# Backend Setup Guide

## Quick Start

1. **Navigate to backend folder:**
```bash
cd backend
```

2. **Install dependencies:**
```bash
npm install
```

3. **Create `.env` file:**
Copy `.env.example` to `.env` and fill in your credentials:
```bash
# Windows PowerShell
Copy-Item .env.example .env

# Or manually create .env with:
SUPABASE_URL=https://aftdnvdkeplbbroeufdt.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://aftdnvdkeplbbroeufdt.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_az9ShzA0Bk_GEv_KB-Kjlg_8WWjQ3ul
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
PORT=3001
FRONTEND_URL=http://localhost:3000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
RESEND_API_KEY=re_E8mxeajE_HvzMLhtM5hbK3ZckXLL5ArpZ
```

4. **Start the server:**
```bash
npm run dev
```

The backend will run on `http://localhost:3001`

## Updating Frontend to Use Backend

You'll need to update the frontend to call the backend API instead of Next.js API routes.

### Option 1: Environment Variable (Recommended)

Add to `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Then update API calls in frontend to use:
```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
fetch(`${API_URL}/auth/signup`, ...)
```

### Option 2: Proxy (Next.js)

Add to `frontend/next.config.js`:
```javascript
async rewrites() {
  return [
    {
      source: '/api/:path*',
      destination: 'http://localhost:3001/api/:path*',
    },
  ];
}
```

This way frontend can still use `/api/*` and it will proxy to the backend.

## API Routes Status

✅ Created:
- `/api/auth/*` - Authentication (signup, signin, signout, forgot-password, reset-password, verify-email)
- `/api/profile` - Profile GET and PATCH

🔄 To Convert (from Next.js routes):
- `/api/jobs`
- `/api/applications`
- `/api/matches`
- `/api/notifications`
- `/api/messages`
- `/api/training`
- `/api/data-collection`
- `/api/stats`
- `/api/admin/*`
- `/api/contact`
- `/api/profile/upload-document`

## Testing

Test the backend:
```bash
# Health check
curl http://localhost:3001/health

# Or in browser
http://localhost:3001/health
```
