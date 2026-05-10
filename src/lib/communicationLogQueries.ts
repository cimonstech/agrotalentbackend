import { getSupabaseAdminClient } from './supabase.js'

type AdminDb = ReturnType<typeof getSupabaseAdminClient>

export interface ProfileContactIds {
  id: string
  email?: string | null
  phone?: string | null
}

export interface CommunicationLogRecord {
  id?: string
  type?: string | null
  channel?: string | null
  event_type?: string | null
  recipients?: string | null
  recipient_count?: number | null
  triggered_by?: string | null
  recipient_email?: string | null
  recipient_phone?: string | null
  subject?: string | null
  message?: string | null
  status?: string | null
  created_at?: string | null
  created_by?: string | null
  error_details?: unknown
}

function normalizeDigits(input: string | null | undefined): string[] {
  if (!input) return []
  const d = input.replace(/\D/g, '')
  if (d.length < 9) return []
  const variants = new Set<string>()
  variants.add(d)
  if (d.startsWith('233')) variants.add(d.slice(3))
  if (d.length === 10 && d.startsWith('0')) variants.add(d.slice(1))
  return [...variants]
}

/** Rows tied to this profile (automation + admin messaging via related_user_id or matched recipient email/phone). */
export async function fetchCommunicationLogsForProfile(
  supabaseAdmin: AdminDb,
  profile: ProfileContactIds,
  limit = 80
): Promise<CommunicationLogRecord[]> {
  const collected = new Map<string, CommunicationLogRecord>()
  const addRows = (rows: CommunicationLogRecord[] | null | undefined) => {
    for (const r of rows ?? []) {
      const id = r?.id
      if (id) collected.set(id, r)
    }
  }

  const { data: byUser } = await supabaseAdmin
    .from('communication_logs')
    .select('*')
    .eq('related_user_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  addRows((byUser ?? []) as CommunicationLogRecord[])

  const email = profile.email?.trim().toLowerCase()
  if (email) {
    const { data: byEmail } = await supabaseAdmin
      .from('communication_logs')
      .select('*')
      .ilike('recipient_email', email)
      .order('created_at', { ascending: false })
      .limit(limit)
    addRows((byEmail ?? []) as CommunicationLogRecord[])
  }

  for (const digits of normalizeDigits(profile.phone)) {
    const { data: byPhone } = await supabaseAdmin
      .from('communication_logs')
      .select('*')
      .ilike('recipient_phone', `%${digits}%`)
      .order('created_at', { ascending: false })
      .limit(limit)
    addRows((byPhone ?? []) as CommunicationLogRecord[])
  }

  const merged = [...collected.values()]
  merged.sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0
    return tb - ta
  })

  return merged.slice(0, limit)
}

export async function insertAdminManualRecipientLog(
  supabaseAdmin: AdminDb,
  params: {
    adminUserId: string
    channel: 'email' | 'sms'
    relatedUserId: string | null
    recipientEmail: string | null
    recipientPhone: string | null
    subject: string | null
    message: string
    status: 'sent' | 'failed'
    errorDetail?: string | null
  }
): Promise<void> {
  try {
    const err =
      params.errorDetail != null && params.errorDetail !== ''
        ? [{ detail: params.errorDetail }]
        : null
    await supabaseAdmin.from('communication_logs').insert({
      type: params.channel,
      channel: params.channel,
      event_type: 'admin_manual',
      recipients: 'single',
      recipient_email: params.recipientEmail,
      recipient_phone: params.recipientPhone,
      subject: params.subject,
      message: params.message.slice(0, 12000),
      recipient_count: 1,
      success_count: params.status === 'sent' ? 1 : 0,
      failure_count: params.status === 'failed' ? 1 : 0,
      status: params.status,
      related_user_id: params.relatedUserId,
      triggered_by: 'admin',
      created_by: params.adminUserId,
      error_details: err,
    })
  } catch {
    // Logging must never block sends
  }
}
