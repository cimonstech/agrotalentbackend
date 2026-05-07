import express from 'express'
import { authenticate } from '../middleware/auth.js'
import type { AuthRequest } from '../types/auth.js'
import { getSupabaseAdminClient } from '../lib/supabase.js'
import { recordFarmConversion } from '../services/farmConversion.js'

const router = express.Router()

router.post('/convert-preview', authenticate, async (req, res) => {
  try {
    const authReq = req as AuthRequest
    const farmId = authReq.user?.id
    const { token } = req.body as { token?: string }

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Token is required' })
    }

    if (!farmId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const result = await recordFarmConversion(token, farmId)

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    return res.json({ success: true, jobId: result.jobId })
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }
})

// GET /api/farms/preview/:token/applications
// Public endpoint — token is the access control
// Returns anonymized candidate previews (no names, no contact info)
router.get('/preview/:token/applications', async (req, res) => {
  try {
    const supabase = getSupabaseAdminClient()
    const { token } = req.params

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Token is required' })
    }

    // Look up the token to get the job_id
    const { data: tokenRow, error: tokenErr } = await supabase
      .from('farm_preview_tokens')
      .select('job_id, converted_at')
      .eq('token', token)
      .single()

    if (tokenErr || !tokenRow?.job_id) {
      return res.status(404).json({ error: 'Invalid token' })
    }

    // Fetch sanitized applications for this job
    const { data: apps, error: appsErr } = await supabase
      .from('applications')
      .select(`
        id,
        match_score,
        status,
        profiles!applications_applicant_id_fkey (
          qualification,
          specialization,
          city,
          preferred_region
        )
      `)
      .eq('job_id', tokenRow.job_id)
      .order('match_score', { ascending: false })

    if (appsErr) throw appsErr

    // Anonymize — no names, no contact details, no IDs
    const sanitized = (apps ?? []).map((app, index) => {
      const raw = app.profiles as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | null
      const profile = Array.isArray(raw)
        ? (raw[0] as Record<string, unknown> | undefined) ?? null
        : raw
      const locCity = profile?.city as string | null | undefined
      const locRegion = profile?.preferred_region as string | null | undefined
      return {
        label: 'Candidate ' + (index + 1),
        match_score: app.match_score as number | null,
        status: app.status as string | null,
        qualification: (profile?.qualification as string | null | undefined) ?? null,
        specialization:
          (profile?.specialization as string | null | undefined) ?? null,
        location: locCity ?? locRegion ?? null,
      }
    })

    return res.json({ applications: sanitized, total: sanitized.length })
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }
})

export default router
