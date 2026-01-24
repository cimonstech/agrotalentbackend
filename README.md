# AgroTalent Hub Backend API

Express.js backend server for AgroTalent Hub.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

3. Update `.env` with your credentials:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key
- `FRONTEND_URL` - Frontend URL (default: http://localhost:3000)
- `PORT` - Backend server port (default: 3001)

4. Run the server:
```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

The server will run on `http://localhost:3001`

## API Endpoints

All endpoints are prefixed with `/api`:

- `/api/auth/*` - Authentication routes
- `/api/profile/*` - Profile management
- `/api/jobs/*` - Job management
- `/api/applications/*` - Application management
- `/api/matches/*` - Matching algorithm
- `/api/notifications/*` - Notifications
- `/api/messages/*` - Messaging
- `/api/training/*` - Training sessions
- `/api/admin/*` - Admin operations
- `/api/stats/*` - Statistics
- `/api/contact/*` - Contact form

## Health Check

```
GET /health
```

Returns server status and timestamp.
