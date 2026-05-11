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
  return Array.from(variants)
}

/** Maps transactional rows from `email_logs` (Resend / Fish Africa loggers) into the communication history shape. */
function mapEmailLogRowToCommunicationRecord(row: {
  id: string
  recipient_email: string | null
  recipient_name?: string | null
  subject?: string | null
  type?: string | null
  status?: string | null
  error_message?: string | null
  metadata?: Record<string, unknown> | null
  sent_at?: string | null
  created_at?: string | null
}): CommunicationLogRecord {
  const syntheticId = `email_log:${row.id}`
  const rawRecipient = String(row.recipient_email ?? '')
  const isSmsPseudo = /^sms:/i.test(rawRecipient)
  const phoneFromPseudo = isSmsPseudo ? rawRecipient.replace(/^sms:/i, '').trim() : null
  const meta =
    row.metadata && typeof row.metadata === 'object' ? row.metadata : null
  const metaPhone = typeof meta?.phone === 'string' ? meta.phone.trim() : null
  const typeStr = String(row.type ?? '').toLowerCase()
  const channel = typeStr === 'sms' || isSmsPseudo ? 'sms' : 'email'

  const parts: string[] = []
  if (row.subject?.trim()) parts.push(row.subject.trim())
  if (typeStr && !['email', 'sms'].includes(typeStr))
    parts.push(`Type: ${typeStr.replace(/_/g, ' ')}`)
  if (row.error_message?.trim()) parts.push(`Error: ${row.error_message.trim()}`)

  return {
    id: syntheticId,
    type: channel,
    channel,
    event_type: typeStr ? typeStr.replace(/_/g, ' ') : 'transactional',
    recipients: null,
    recipient_email: isSmsPseudo ? null : rawRecipient || null,
    recipient_phone: metaPhone || phoneFromPseudo,
    subject: row.subject ?? null,
    message: parts.join(' · ') || 'Transactional message',
    status: row.status ?? null,
    created_at: row.sent_at ?? row.created_at ?? null,
    triggered_by: 'system',
  }
}

function isMissingRelationError(err: { message?: string } | null): boolean {
  const m = String(err?.message ?? '')
  return m.includes('does not exist') || m.includes('schema cache')
}

/** Rows tied to this profile (communication_logs + matching email_logs delivery records). */
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
      .ilike('recipient_email', `%${email}%`)
      .order('created_at', { ascending: false })
      .limit(limit)
    addRows((byEmail ?? []) as CommunicationLogRecord[])

    const elRes = await supabaseAdmin
      .from('email_logs')
      .select('*')
      .ilike('recipient_email', `%${email}%`)
      .order('sent_at', { ascending: false })
      .limit(limit)
    if (!elRes.error && elRes.data) {
      addRows(elRes.data.map(mapEmailLogRowToCommunicationRecord))
    } else if (elRes.error && !isMissingRelationError(elRes.error)) {
      console.warn('[fetchCommunicationLogsForProfile] email_logs:', elRes.error.message)
    }
  }

  for (const digits of normalizeDigits(profile.phone)) {
    const { data: byPhone } = await supabaseAdmin
      .from('communication_logs')
      .select('*')
      .ilike('recipient_phone', `%${digits}%`)
      .order('created_at', { ascending: false })
      .limit(limit)
    addRows((byPhone ?? []) as CommunicationLogRecord[])

    const smsElRes = await supabaseAdmin
      .from('email_logs')
      .select('*')
      .ilike('recipient_email', `%sms:${digits}%`)
      .order('sent_at', { ascending: false })
      .limit(limit)
    if (!smsElRes.error && smsElRes.data) {
      addRows(smsElRes.data.map(mapEmailLogRowToCommunicationRecord))
    } else if (smsElRes.error && !isMissingRelationError(smsElRes.error)) {
      console.warn('[fetchCommunicationLogsForProfile] email_logs sms:', smsElRes.error.message)
    }
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
