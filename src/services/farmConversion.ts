import { getSupabaseAdminClient } from '../lib/supabase.js'
import { sendNotificationEmail } from './email-service.js'
import { fireAndForget } from '../lib/notify.js'

export async function recordFarmConversion(
  token: string,
  farmId: string
): Promise<{
  success: boolean
  jobId: string | null
  jobsTransferred: number
  error?: string
}> {
  const supabase = getSupabaseAdminClient()

  // 1. Look up the token
  const { data: tokenRow, error: tokenError } = await supabase
    .from('farm_preview_tokens')
    .select('id, job_id, source_name, converted_at')
    .eq('token', token)
    .single()

  if (tokenError || !tokenRow) {
    return {
      success: false,
      jobId: null,
      jobsTransferred: 0,
      error: 'Token not found',
    }
  }

  // Idempotent: already converted
  if (tokenRow.converted_at) {
    return {
      success: true,
      jobId: (tokenRow.job_id as string | null) ?? null,
      jobsTransferred: 0,
    }
  }

  const primaryJobId = (tokenRow.job_id as string | null) ?? null

  // 2. Get the source identifiers from the primary job
  let sourcePhone: string | null = null
  let sourceContact: string | null = null

  if (primaryJobId) {
    const { data: primaryJob } = await supabase
      .from('jobs')
      .select('source_phone, source_contact')
      .eq('id', primaryJobId)
      .single()

    sourcePhone = primaryJob?.source_phone ?? null
    sourceContact = primaryJob?.source_contact ?? null
  }

  // 3. Find ALL sourced jobs belonging to this source employer
  // Match by source_phone OR source_contact (whichever is available)
  let allSourcedJobIds: string[] = []

  if (primaryJobId) {
    let query = supabase
      .from('jobs')
      .select('id')
      .eq('is_sourced_job', true)
      .is('deleted_at', null)

    if (sourcePhone && sourceContact) {
      query = query.or(
        `source_phone.eq.${sourcePhone},source_contact.eq.${sourceContact}`
      )
    } else if (sourcePhone) {
      query = query.eq('source_phone', sourcePhone)
    } else if (sourceContact) {
      query = query.eq('source_contact', sourceContact)
    } else {
      // No source identifiers — fall back to just the primary job
      allSourcedJobIds = [primaryJobId]
    }

    if (allSourcedJobIds.length === 0) {
      const { data: matchedJobs } = await query
      allSourcedJobIds = (matchedJobs ?? []).map((j) => j.id as string)
      // Always include the primary job even if query missed it
      if (primaryJobId && !allSourcedJobIds.includes(primaryJobId)) {
        allSourcedJobIds.push(primaryJobId)
      }
    }
  }

  // 4. Transfer all matched sourced jobs to the new farm in one batch
  let jobsTransferred = 0
  if (allSourcedJobIds.length > 0) {
    const { count: pendingCount } = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .in('id', allSourcedJobIds)
      .eq('is_sourced_job', true)

    const { error: transferError } = await supabase
      .from('jobs')
      .update({
        farm_id: farmId,
        is_sourced_job: false,
        status: 'active',
      })
      .in('id', allSourcedJobIds)
      .eq('is_sourced_job', true)

    if (transferError) {
      return {
        success: false,
        jobId: primaryJobId,
        jobsTransferred: 0,
        error: transferError.message,
      }
    }
    jobsTransferred = pendingCount ?? allSourcedJobIds.length
  }

  // 5. Mark ALL related preview tokens as converted
  // Find tokens linked to any of the transferred jobs
  if (allSourcedJobIds.length > 0) {
    await supabase
      .from('farm_preview_tokens')
      .update({
        registered_farm_id: farmId,
        converted_at: new Date().toISOString(),
      })
      .in('job_id', allSourcedJobIds)
      .is('converted_at', null)
  }

  // Always mark the current token regardless
  await supabase
    .from('farm_preview_tokens')
    .update({
      registered_farm_id: farmId,
      converted_at: new Date().toISOString(),
    })
    .eq('token', token)

  // 6. Invalidate Redis cache for all transferred jobs
  try {
    const { cacheDelPattern, cacheDel } = await import('../lib/redis.js')
    await cacheDelPattern('jobs:public:*')
    for (const jobId of allSourcedJobIds) {
      await cacheDel(`job:${jobId}`)
    }
  } catch {
    // Non-critical
  }

  // 7. Notify admins
  try {
    const { data: admins } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('role', 'admin')

    if (admins && admins.length > 0) {
      const { data: farm } = await supabase
        .from('profiles')
        .select('full_name, farm_name, email, phone')
        .eq('id', farmId)
        .single()

      const farmLabel = farm?.farm_name ?? farm?.full_name ?? 'Unknown Farm'

      for (const admin of admins) {
        if (!admin.email) continue
        fireAndForget(
          async () => {
            const result = await sendNotificationEmail(
              admin.email,
              'Sourced Farm Converted',
              `A sourced farm has registered via a preview link.\n\nFarm: ${farmLabel}\nSource: ${tokenRow.source_name ?? 'Unknown'}\nJobs transferred: ${jobsTransferred}\nJob IDs: ${allSourcedJobIds.join(', ')}`,
              admin.full_name ?? '',
              { role: 'admin', ctaUrl: '/dashboard/admin/jobs' }
            )
            if (!result.success) {
              throw new Error(result.error ?? 'send failed')
            }
          },
          'farm-conversion-admin-email',
          {
            event_type: 'farm_converted',
            channel: 'email',
            recipient_email: admin.email,
            subject: 'Sourced Farm Converted',
            message: `Farm conversion: ${jobsTransferred} job(s) transferred`,
            related_job_id: primaryJobId,
            related_user_id: farmId,
            triggered_by: 'system',
          }
        )
      }
    }
  } catch {
    // Non-critical
  }

  return { success: true, jobId: primaryJobId, jobsTransferred }
}
