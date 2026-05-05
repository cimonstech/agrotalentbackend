import { Router } from 'express'
import { getSupabaseAdminClient } from '../lib/supabase.js'

const router = Router()

router.get('/', async (_req, res) => {
  const start = Date.now()
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {}

  // Check Supabase connectivity
  try {
    const supabase = getSupabaseAdminClient()
    const dbStart = Date.now()
    const { error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1)
      .single()
    checks.database = error && error.code !== 'PGRST116'
      ? { status: 'unhealthy', error: error.message }
      : { status: 'healthy', latencyMs: Date.now() - dbStart }
  } catch (err) {
    checks.database = {
      status: 'unhealthy',
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }

  // Check R2 connectivity
  try {
    const r2Url = process.env.R2_PUBLIC_URL
    if (r2Url) {
      const r2Start = Date.now()
      const r2Res = await fetch(r2Url, { method: 'HEAD', signal: AbortSignal.timeout(3000) })
      checks.r2 = r2Res.ok || r2Res.status === 403 || r2Res.status === 404
        ? { status: 'healthy', latencyMs: Date.now() - r2Start }
        : { status: 'unhealthy', error: `HTTP ${r2Res.status}` }
    } else {
      checks.r2 = { status: 'unconfigured' }
    }
  } catch (err) {
    checks.r2 = {
      status: 'unhealthy',
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }

  const allHealthy = Object.values(checks).every(
    (c) => c.status === 'healthy' || c.status === 'unconfigured'
  )

  return res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ok' : 'degraded',
    uptime: process.uptime(),
    totalLatencyMs: Date.now() - start,
    checks,
    timestamp: new Date().toISOString(),
  })
})

export default router
