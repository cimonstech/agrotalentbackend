import { getSupabaseAdminClient } from './supabase.js'

interface LogCommunicationParams {
  type: 'email' | 'sms'
  channel: 'email' | 'sms' | 'both'
  event_type: string
  recipient_email?: string | null
  recipient_phone?: string | null
  subject?: string | null
  message: string
  status: 'sent' | 'failed' | 'pending'
  related_job_id?: string | null
  related_user_id?: string | null
  triggered_by?: 'system' | 'admin' | 'cron'
  error_details?: unknown
}

export async function logCommunication(
  params: LogCommunicationParams
): Promise<void> {
  try {
    const supabase = getSupabaseAdminClient()
    await supabase.from('communication_logs').insert({
      type: params.type,
      channel: params.channel,
      event_type: params.event_type,
      recipient_email: params.recipient_email ?? null,
      recipient_phone: params.recipient_phone ?? null,
      subject: params.subject ?? null,
      message: params.message,
      status: params.status,
      related_job_id: params.related_job_id ?? null,
      related_user_id: params.related_user_id ?? null,
      triggered_by: params.triggered_by ?? 'system',
      error_details: params.error_details
        ? JSON.stringify(params.error_details)
        : null,
      recipients: params.recipient_email ?? params.recipient_phone ?? 'unknown',
      recipient_count: 1,
      success_count: params.status === 'sent' ? 1 : 0,
      failure_count: params.status === 'failed' ? 1 : 0,
    })
  } catch {
    // Logging must never throw or block the main flow
  }
}
