import type { Request } from 'express'
import { Buffer } from 'node:buffer'

/**
 * Stable per-user CSRF binding. Using the raw JWT string breaks whenever the
 * access token is refreshed. Supabase JWT `sub` matches auth user id.
 */
export function csrfSessionIdentifier(req: Request): string {
  const raw = req.headers.authorization
  if (typeof raw === 'string' && raw.startsWith('Bearer ')) {
    const jwt = raw.slice(7).trim()
    const a = jwt.indexOf('.')
    const b = jwt.indexOf('.', a + 1)
    if (a > 0 && b > a) {
      const payloadB64 = jwt.slice(a + 1, b)
      try {
        const json = JSON.parse(
          Buffer.from(payloadB64, 'base64url').toString('utf8')
        ) as { sub?: string }
        if (json?.sub && typeof json.sub === 'string') {
          return `sub:${json.sub}`
        }
      } catch {
        /* fall through */
      }
    }
  }
  return String(req.ip ?? 'anonymous')
}

/** Secure cookies only over HTTPS unless explicitly disabled for local prod builds. */
export function csrfCookieSecure(): boolean {
  const override = process.env.CSRF_COOKIE_SECURE
  if (override === '0' || override === 'false') return false
  if (override === '1' || override === 'true') return true
  const front = process.env.FRONTEND_URL || ''
  if (front.startsWith('https://')) return true
  if (front.startsWith('http://')) return false
  return process.env.NODE_ENV === 'production'
}

export function csrfSameSite(): 'strict' | 'lax' | 'none' {
  const v = process.env.CSRF_SAME_SITE
  if (v === 'strict' || v === 'lax' || v === 'none') return v
  return 'lax'
}
