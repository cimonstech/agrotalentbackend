import express from 'express'
import rateLimit from 'express-rate-limit'
import { getSupabaseAdminClient } from '../lib/supabase.js'
import { authenticate } from '../middleware/auth.js'
import type { AuthRequest } from '../types/auth.js'

const GHANA_REGIONS = new Set([
  'Greater Accra',
  'Ashanti',
  'Western',
  'Eastern',
  'Central',
  'Volta',
  'Northern',
  'Upper East',
  'Upper West',
  'Brong-Ahafo',
  'Western North',
  'Ahafo',
  'Bono',
  'Bono East',
  'Oti',
  'Savannah',
  'North East',
  'Oti',
])

const ipViewCache = new Map<string, number>()

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000
  for (const [key, timestamp] of ipViewCache.entries()) {
    if (timestamp < cutoff) ipViewCache.delete(key)
  }
}, 5 * 60 * 1000)

const router = express.Router()

const jobViewLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
  skip: (req) => {
    return !!req.headers.authorization?.startsWith('Bearer ')
  },
})

// POST /api/analytics/job-view - record a job view (public, optional auth)
router.post('/job-view', jobViewLimiter, async (req, res) => {
  try {
    const supabase = getSupabaseAdminClient()
    const body = req.body as { job_id?: string; viewer_region?: string | null }
    const { job_id } = body

    if (!job_id || typeof job_id !== 'string') {
      return res.status(400).json({ error: 'job_id is required' })
    }

    let viewerRegionFromBody: string | null = null
    const rawBodyRegion = body.viewer_region
    if (typeof rawBodyRegion === 'string') {
      viewerRegionFromBody = rawBodyRegion.trim() || null
      if (viewerRegionFromBody && !GHANA_REGIONS.has(viewerRegionFromBody)) {
        viewerRegionFromBody = null
      }
    }

    let viewerId: string | null = null
    let viewerRole = 'anonymous'
    let viewerRegion: string | null = viewerRegionFromBody

    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const {
        data: { user },
      } = await supabase.auth.getUser(token)
      if (user) {
        viewerId = user.id
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, preferred_region, farm_location')
          .eq('id', user.id)
          .maybeSingle()
        if (profile) {
          viewerRole = (profile as { role?: string | null }).role ?? 'anonymous'
          const p = profile as {
            preferred_region?: string | null
            farm_location?: string | null
          }
          viewerRegion = p.preferred_region ?? p.farm_location ?? viewerRegion
        }
      }
    }

    if (viewerRegion && !GHANA_REGIONS.has(viewerRegion)) {
      viewerRegion = null
    }

    if (viewerId) {
      const { data: recent } = await supabase
        .from('job_views')
        .select('id')
        .eq('job_id', job_id)
        .eq('viewer_id', viewerId)
        .gte(
          'viewed_at',
          new Date(Date.now() - 30 * 60 * 1000).toISOString()
        )
        .limit(1)

      if (recent && recent.length > 0) {
        return res.json({ recorded: false, reason: 'duplicate' })
      }
    }

    if (!viewerId) {
      const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
      const ipKey = `anon_view_${job_id}_${ip}`
      if (ipViewCache.has(ipKey)) {
        return res.json({ recorded: false, reason: 'duplicate' })
      }
      ipViewCache.set(ipKey, Date.now())
    }

    const { error: insertError } = await supabase.from('job_views').insert({
      job_id,
      viewer_id: viewerId,
      viewer_role: viewerRole,
      viewer_region: viewerRegion,
    })

    if (insertError) {
      return res.status(500).json({ error: insertError.message })
    }

    return res.json({ recorded: true })
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }
})

// GET /api/analytics/job/:jobId - view stats for a single job
router.get('/job/:jobId', authenticate, async (req, res) => {
  try {
    const supabase = getSupabaseAdminClient()
    const { jobId } = req.params as { jobId: string }
    const userId = (req as AuthRequest).user.id

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle()

    if ((profile as { role?: string | null } | null)?.role !== 'admin') {
      const { data: job } = await supabase
        .from('jobs')
        .select('farm_id')
        .eq('id', jobId)
        .maybeSingle()

      if (!job || (job as { farm_id?: string | null }).farm_id !== userId) {
        return res.status(403).json({ error: 'Not authorised' })
      }
    }

    const { data: counts } = await supabase
      .from('job_view_counts')
      .select('total_views, unique_views, views_30d, views_7d')
      .eq('job_id', jobId)
      .maybeSingle()

    const { count: applicationCount } = await supabase
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId)

    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString()
    const { data: dailyViews } = await supabase.rpc('get_daily_job_views', {
      p_job_id: jobId,
      p_since: thirtyDaysAgo,
    })

    const c = (counts ?? null) as
      | {
          total_views?: number | null
          unique_views?: number | null
          views_30d?: number | null
          views_7d?: number | null
        }
      | null

    return res.json({
      job_id: jobId,
      total_views: c?.total_views ?? 0,
      unique_views: c?.unique_views ?? 0,
      views_30d: c?.views_30d ?? 0,
      views_7d: c?.views_7d ?? 0,
      applications: applicationCount ?? 0,
      daily_views: dailyViews ?? [],
    })
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }
})

// GET /api/analytics/farm-overview - all jobs for logged-in farm
router.get('/farm-overview', authenticate, async (req, res) => {
  try {
    const supabase = getSupabaseAdminClient()
    const userId = (req as AuthRequest).user.id

    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, title, status, created_at, location, job_type')
      .eq('farm_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (!jobs || jobs.length === 0) {
      return res.json({ jobs: [] })
    }

    const jobIds = (jobs as Array<{ id: string }>).map((j) => j.id)

    const { data: viewCounts } = await supabase
      .from('job_view_counts')
      .select('job_id, total_views, unique_views, views_30d, views_7d')
      .in('job_id', jobIds)

    const { data: appCounts } = await supabase.rpc(
      'get_application_counts_by_jobs',
      { p_job_ids: jobIds }
    )

    const viewMap = new Map(
      (viewCounts ?? []).map((v: any) => [v.job_id as string, v])
    )
    const appMap = new Map(
      (appCounts ?? []).map((a: any) => [a.job_id as string, Number(a.count) ?? 0])
    )

    const enrichedJobs = (jobs as any[]).map((job) => {
      const views = viewMap.get(job.id as string)
      return {
        ...job,
        total_views: (views?.total_views as number | null) ?? 0,
        unique_views: (views?.unique_views as number | null) ?? 0,
        views_30d: (views?.views_30d as number | null) ?? 0,
        views_7d: (views?.views_7d as number | null) ?? 0,
        applications: appMap.get(job.id as string) ?? 0,
      }
    })

    return res.json({ jobs: enrichedJobs })
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }
})

// GET /api/analytics/admin-overview - platform-wide stats for admins
router.get('/admin-overview', authenticate, async (req, res) => {
  try {
    const supabase = getSupabaseAdminClient()
    const userId = (req as AuthRequest).user.id

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle()

    if ((profile as { role?: string | null } | null)?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' })
    }

    const { data: topJobs } = await supabase
      .from('job_view_counts')
      .select('job_id, total_views, unique_views, views_30d')
      .order('total_views', { ascending: false })
      .limit(10)

    let enrichedTopJobs: unknown[] = []
    if (topJobs && topJobs.length > 0) {
      const jobIds = (topJobs as Array<{ job_id: string }>).map((t) => t.job_id)
      const { data: jobDetails } = await supabase
        .from('jobs')
        .select('id, title, location, status, profiles:farm_id(farm_name, full_name)')
        .in('id', jobIds)

      const jobMap = new Map((jobDetails ?? []).map((j: any) => [j.id as string, j]))

      const { data: appCounts } = await supabase.rpc(
        'get_application_counts_by_jobs',
        { p_job_ids: jobIds }
      )

      const appMap = new Map(
        (appCounts ?? []).map((a: any) => [a.job_id as string, Number(a.count) ?? 0])
      )

      enrichedTopJobs = (topJobs as any[]).map((t) => {
        const job = jobMap.get(t.job_id as string)
        const farm = job?.profiles
        const farmObj = Array.isArray(farm) ? farm[0] : farm
        return {
          ...t,
          title: job?.title ?? 'Unknown',
          location: job?.location ?? '',
          status: job?.status ?? '',
          farm_name: farmObj?.farm_name ?? farmObj?.full_name ?? 'Unknown',
          applications: appMap.get(t.job_id as string) ?? 0,
        }
      })
    }

    const { count: totalViews } = await supabase
      .from('job_views')
      .select('id', { count: 'exact', head: true })

    const sevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    ).toISOString()
    const { count: views7d } = await supabase
      .from('job_views')
      .select('id', { count: 'exact', head: true })
      .gte('viewed_at', sevenDaysAgo)

    const sevenDaysAgoDate = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    ).toISOString()
    const { data: activeJobs } = await supabase
      .from('jobs')
      .select('id, title, location, created_at, profiles:farm_id(farm_name, full_name)')
      .eq('status', 'active')
      .is('deleted_at', null)
      .lt('created_at', sevenDaysAgoDate)

    const zeroViewJobs: unknown[] = []
    if (activeJobs && activeJobs.length > 0) {
      const activeIds = (activeJobs as Array<{ id: string }>).map((j) => j.id)
      const { data: viewedIds } = await supabase
        .from('job_view_counts')
        .select('job_id')
        .in('job_id', activeIds)
        .gt('total_views', 0)

      const viewedSet = new Set((viewedIds ?? []).map((v: any) => v.job_id as string))
      for (const job of activeJobs as any[]) {
        if (!viewedSet.has(job.id as string)) {
          const farm = job.profiles
          const farmObj = Array.isArray(farm) ? farm[0] : farm
          zeroViewJobs.push({
            id: job.id,
            title: job.title,
            location: job.location,
            created_at: job.created_at,
            farm_name: farmObj?.farm_name ?? farmObj?.full_name ?? 'Unknown',
          })
        }
      }
    }

    return res.json({
      total_views: totalViews ?? 0,
      views_7d: views7d ?? 0,
      top_jobs: enrichedTopJobs,
      zero_view_jobs: zeroViewJobs,
    })
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }
})

export default router

