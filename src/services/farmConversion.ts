import { getSupabaseAdminClient } from '../lib/supabase.js'
import { sendNotificationEmail } from './email-service.js'
import { fireAndForget } from '../lib/notify.js'

function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('233') && digits.length > 9) {
    return '0' + digits.slice(3)
  }
  return digits
}

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

  // 2. Source identifiers from primary job (context); match via farm profile below
  if (primaryJobId) {
    await supabase
      .from('jobs')
      .select('source_phone, source_contact')
      .eq('id', primaryJobId)
      .single()
  }

  // 3. Find ALL sourced jobs for this employer (normalized phone or email)
  let allSourcedJobIds: string[] = []

  if (primaryJobId) {
    const { data: farmProfile } = await supabase
      .from('profiles')
      .select('phone, email')
      .eq('id', farmId)
      .single()

    const farmPhone = normalizePhone(farmProfile?.phone)
    const farmEmail = (farmProfile?.email ?? '').toLowerCase().trim()

    const { data: allSourcedJobs } = await supabase
      .from('jobs')
      .select('id, source_phone, source_contact')
      .eq('is_sourced_job', true)
      .is('deleted_at', null)

    allSourcedJobIds = (allSourcedJobs ?? [])
      .filter((j) => {
        const jobPhone = normalizePhone(j.source_phone as string | null)
        const jobEmail = ((j.source_contact as string | null) ?? '')
          .toLowerCase()
          .trim()
        const phoneMatch = Boolean(farmPhone && jobPhone && jobPhone === farmPhone)
        const emailMatch = Boolean(farmEmail && jobEmail && jobEmail === farmEmail)
        return phoneMatch || emailMatch
      })
      .map((j) => j.id as string)

    if (primaryJobId && !allSourcedJobIds.includes(primaryJobId)) {
      allSourcedJobIds.push(primaryJobId)
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
