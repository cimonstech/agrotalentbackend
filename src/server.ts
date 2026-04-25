import * as Sentry from '@sentry/node'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'
import { doubleCsrf } from 'csrf-csrf'
import authRoutes from './routes/auth.js'
import profileRoutes from './routes/profile.js'
import documentsRoutes from './routes/documents.js'
import jobsRoutes from './routes/jobs.js'
import applicationsRoutes from './routes/applications.js'
import matchesRoutes from './routes/matches.js'
import notificationsRoutes from './routes/notifications.js'
import noticesRoutes from './routes/notices.js'
import messagesRoutes from './routes/messages.js'
import trainingRoutes from './routes/training.js'
import dataCollectionRoutes from './routes/data-collection.js'
import statsRoutes from './routes/stats.js'
import adminRoutes from './routes/admin.js'
import contactRoutes from './routes/contact.js'
import placementsRoutes from './routes/placements.js'
import paymentsRouter, { paymentsWebhookHandler } from './routes/payments.js'
import { errorMessage } from './lib/errors.js'
import {
  csrfCookieSecure,
  csrfSameSite,
  csrfSessionIdentifier,
} from './lib/csrf-session.js'
import {
  authLimiter,
  writeLimiter,
  readLimiter,
  publicFormLimiter,
} from './middleware/rateLimiter.js'

dotenv.config()
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
    integrations: [Sentry.expressIntegration()],
  })
}

const app = express()
app.set('trust proxy', 1)

const PORT: number = Number(process.env.PORT) || 3001

app.use(compression())

// csrf-csrf reads req.cookies; Express only populates this with cookie-parser
app.use(cookieParser())

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
  })
)

app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    void paymentsWebhookHandler(req, res).catch(next)
  }
)

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET ?? 'agrotalent-csrf-secret-change-in-production',
  getSessionIdentifier: csrfSessionIdentifier,
  cookieName: 'x-csrf-token',
  cookieOptions: {
    secure: csrfCookieSecure(),
    sameSite: csrfSameSite(),
    httpOnly: true,
  },
  size: 64,
  getCsrfTokenFromRequest: (req: Request) => {
    const h = req.headers
    const raw = h?.['x-csrf-token'] ?? h?.['X-CSRF-TOKEN']
    if (typeof raw === 'string') return raw
    if (Array.isArray(raw)) return raw[0] ?? ''
    return ''
  },
})

app.get('/api/csrf-token', (req, res) => {
  res.json({ token: generateCsrfToken(req, res) })
})

app.use('/api/auth', doubleCsrfProtection)
app.use('/api/applications', doubleCsrfProtection)
app.use('/api/jobs', doubleCsrfProtection)
app.use('/api/placements', doubleCsrfProtection)
app.use('/api/payments', doubleCsrfProtection)
app.use('/api/messages', doubleCsrfProtection)
app.use('/api/profile', doubleCsrfProtection)
app.use('/api/admin', doubleCsrfProtection)
app.use('/api/documents', doubleCsrfProtection)
app.use('/api/training', doubleCsrfProtection)
app.use('/api/notices', doubleCsrfProtection)
app.use('/api/contact', doubleCsrfProtection)

// Auth routes: strict
app.use('/api/auth', authLimiter)
// Public form routes: very strict
app.use('/api/contact', publicFormLimiter)
// Write operations: medium
app.use('/api/applications', writeLimiter)
app.use('/api/placements', writeLimiter)
app.use('/api/payments', writeLimiter)
app.use('/api/messages', writeLimiter)
app.use('/api/documents', writeLimiter)
// Read operations: loose
app.use('/api/jobs', readLimiter)
app.use('/api/notifications', readLimiter)
app.use('/api/profile', readLimiter)
app.use('/api/matches', readLimiter)
// Admin: medium (authenticated anyway)
app.use('/api/admin', writeLimiter)
// Training
app.use('/api/training', writeLimiter)
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Missing Supabase configuration. Please set SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env'
  )
  process.exit(1)
}

if (!supabaseServiceKey) {
  console.warn(
    'SUPABASE_SERVICE_ROLE_KEY not set. Admin operations may not work.'
  )
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/auth', authRoutes)
app.use('/api/profile', profileRoutes)
app.use('/api/documents', documentsRoutes)
app.use('/api/jobs', jobsRoutes)
app.use('/api/applications', applicationsRoutes)
app.use('/api/matches', matchesRoutes)
app.use('/api/notifications', notificationsRoutes)
app.use('/api/notices', noticesRoutes)
app.use('/api/messages', messagesRoutes)
app.use('/api/training', trainingRoutes)
app.use('/api/data-collection', dataCollectionRoutes)
app.use('/api/stats', statsRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/contact', contactRoutes)
app.use('/api/placements', placementsRoutes)
app.use('/api/payments', paymentsRouter)

if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app)
}

interface HttpError extends Error {
  status?: number
  statusCode?: number
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err)
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err)
  }
  const e = err as HttpError
  const status =
    typeof e.status === 'number'
      ? e.status
      : typeof e.statusCode === 'number'
        ? e.statusCode
        : 500
  res.status(status).json({
    error: errorMessage(err) || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' &&
      err instanceof Error && { stack: err.stack }),
  })
})

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' })
})

const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RESEND_API_KEY',
  'PAYSTACK_SECRET_KEY',
  'FRONTEND_URL',
  'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_URL',
  'CSRF_SECRET',
  'FISH_AFRICA_APP_ID',
  'FISH_AFRICA_APP_SECRET',
]

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key])
if (missingEnv.length > 0) {
  console.error('Missing required environment variables:', missingEnv.join(', '))
  process.exit(1)
}

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`)
  console.log(`Health check: http://localhost:${PORT}/health`)
})

export default app