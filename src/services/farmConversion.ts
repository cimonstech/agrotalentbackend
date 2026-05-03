import { getSupabaseAdminClient } from '../lib/supabase.js'
import { sendNotificationEmail } from './email-service.js'

export async function recordFarmConversion(
  token: string,
  farmId: string
): Promise<{ success: boolean; jobId: string | null; error?: string }> {
  const supabase = getSupabaseAdminClient()

  const { data: tokenRow, error: tokenError } = await supabase
    .from('farm_preview_tokens')
    .select('id, job_id, source_name, converted_at')
    .eq('token', token)
    .single()

  if (tokenError || !tokenRow) {
    return { success: false, jobId: null, error: 'Token not found' }
  }

  if (tokenRow.converted_at) {
    return { success: true, jobId: (tokenRow.job_id as string | null) ?? null }
  }

  if (tokenRow.job_id) {
    const { error: jobError } = await supabase
      .from('jobs')
      .update({
        farm_id: farmId,
        is_sourced_job: false,
        status: 'active',
      })
      .eq('id', tokenRow.job_id as string)
      .eq('is_sourced_job', true)

    if (jobError) {
      return { success: false, jobId: null, error: jobError.message }
    }
  }

  const { error: markError } = await supabase
    .from('farm_preview_tokens')
    .update({
      registered_farm_id: farmId,
      converted_at: new Date().toISOString(),
    })
    .eq('token', token)

  if (markError) {
    return { success: false, jobId: null, error: markError.message }
  }

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
        await sendNotificationEmail(
          admin.email,
          'Sourced Farm Converted',
          `A sourced farm has registered via a preview link.\n\nFarm: ${farmLabel}\nSource: ${tokenRow.source_name ?? 'Unknown'}\nJob ID: ${String(tokenRow.job_id ?? 'None')}`,
          admin.full_name ?? '',
          { role: 'admin', ctaUrl: '/dashboard/admin/jobs' }
        ).catch(() => {})
      }
    }
  } catch {
    /* non-critical */
  }

  return { success: true, jobId: (tokenRow.job_id as string | null) ?? null }
}
