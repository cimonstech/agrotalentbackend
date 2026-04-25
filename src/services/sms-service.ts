import axios from 'axios'
import { getSupabaseAdminClient } from '../lib/supabase.js'

const FISH_AFRICA_BASE_URL = 'https://api.letsfish.africa/v1'
const FISH_AFRICA_AUTH = (process.env.FISH_AFRICA_APP_ID ?? '') + '.' + (process.env.FISH_AFRICA_APP_SECRET ?? '')
/** Registered sender on LetsFish Africa; override with FISH_AFRICA_SENDER_ID if needed. */
const SENDER_ID = (process.env.FISH_AFRICA_SENDER_ID ?? 'FISH_AFRICA').trim()

interface SmsRecipient {
  [phoneNumber: string]: Record<string, string>
}

interface SendSmsParams {
  message: string
  recipients: SmsRecipient[]
  campaignName?: string
}

async function sendSms(params: SendSmsParams): Promise<void> {
  const auth = FISH_AFRICA_AUTH.trim()
  if (!auth || auth === '.') {
    console.error('[SMS] Not configured — set FISH_AFRICA_APP_ID and FISH_AFRICA_APP_SECRET')
    return
  }

  const firstRecipient = params.recipients[0]
  const recipientPhone = firstRecipient ? Object.keys(firstRecipient)[0] : 'unknown'

  try {
    const response = await axios.post(
      FISH_AFRICA_BASE_URL + '/sms/templates/send',
      {
        campaign_name: params.campaignName ?? 'AgroTalent Notification',
        sender_id: SENDER_ID,
        message: params.message,
        recipients: params.recipients,
      },
      {
        headers: {
          Authorization: 'Bearer ' + FISH_AFRICA_AUTH,
          'Content-Type': 'application/json',
        },
      }
    )
    console.log(`[SMS] Sent "${params.campaignName}" to ${recipientPhone} — status ${response.status}`)
  } catch (err: unknown) {
    const detail = axios.isAxiosError(err)
      ? `HTTP ${err.response?.status} — ${JSON.stringify(err.response?.data ?? err.message)}`
      : err instanceof Error
        ? err.message
        : String(err)
    console.error(`[SMS] Send failed (campaign="${params.campaignName}", to=${recipientPhone}): ${detail}`)
    return
  }

  const supabase = getSupabaseAdminClient()
  try {
    await supabase.from('email_logs').insert({
      recipient_email: 'sms:' + recipientPhone,
      subject: params.campaignName ?? 'SMS',
      type: 'sms_' + (params.campaignName ?? 'notification').toLowerCase().replace(/\s+/g, '_'),
      status: 'sent',
      sent_at: new Date().toISOString(),
      metadata: { channel: 'sms', campaign: params.campaignName },
    })
  } catch (logErr) {
    console.error('[SMS] Log insert failed:', logErr)
  }
}

function formatPhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-\+]/g, '')
  if (cleaned.startsWith('0')) return '233' + cleaned.slice(1)
  if (cleaned.startsWith('233')) return cleaned
  return '233' + cleaned
}

export type SendRawSmsResult = { success: true } | { success: false; error: string }

/**
 * Plain-text SMS (admin broadcasts, etc.). Uses Fish Africa template API with a single merge field.
 */
export async function sendRawSms(
  phone: string,
  text: string,
  campaignName = 'Admin Communications'
): Promise<SendRawSmsResult> {
  const auth = FISH_AFRICA_AUTH.trim()
  if (!auth || auth === '.') {
    return { success: false, error: 'SMS not configured (FISH_AFRICA_APP_ID / FISH_AFRICA_APP_SECRET)' }
  }
  const formatted = formatPhone(phone)
  try {
    await axios.post(
      FISH_AFRICA_BASE_URL + '/sms/templates/send',
      {
        campaign_name: campaignName,
        sender_id: SENDER_ID,
        message: '{{body}}',
        recipients: [{ [formatted]: { body: text } }],
      },
      {
        headers: {
          Authorization: 'Bearer ' + FISH_AFRICA_AUTH,
          'Content-Type': 'application/json',
        },
      }
    )
    return { success: true }
  } catch (err: unknown) {
    const msg = axios.isAxiosError(err)
      ? JSON.stringify(err.response?.data ?? err.message)
      : err instanceof Error
        ? err.message
        : String(err)
    console.error('sendRawSms failed:', msg)
    return { success: false, error: msg }
  }
}

export async function sendApplicationReceivedSms(
  farmPhone: string,
  farmName: string,
  applicantName: string,
  jobTitle: string
): Promise<void> {
  const phone = formatPhone(farmPhone)
  await sendSms({
    message: 'Hello {{name}}, {{applicant}} has applied for {{job}} on AgroTalent Hub. Log in to review the application.',
    recipients: [{
      [phone]: {
        name: farmName,
        applicant: applicantName,
        job: jobTitle,
      }
    }],
    campaignName: 'Application Received',
  })
}

export async function sendApplicationStatusSms(
  applicantPhone: string,
  applicantName: string,
  jobTitle: string,
  status: string
): Promise<void> {
  const phone = formatPhone(applicantPhone)
  const statusMessages: Record<string, string> = {
    reviewed: 'Your application for {{job}} has been reviewed.',
    shortlisted: 'Congratulations {{name}}! You have been shortlisted for {{job}}.',
    accepted: 'Great news {{name}}! Your application for {{job}} has been accepted.',
    rejected: 'Hi {{name}}, your application for {{job}} was unsuccessful. Keep applying!',
  }
  const message = statusMessages[status] ?? 'Hi {{name}}, your application for {{job}} has been updated.'
  await sendSms({
    message: message + ' Visit AgroTalent Hub for details.',
    recipients: [{
      [phone]: {
        name: applicantName,
        job: jobTitle,
      }
    }],
    campaignName: 'Application Status Update',
  })
}

export async function sendPlacementConfirmedSms(
  graduatePhone: string,
  graduateName: string,
  jobTitle: string,
  farmName: string
): Promise<void> {
  const phone = formatPhone(graduatePhone)
  await sendSms({
    message: 'Congratulations {{name}}! Your placement at {{farm}} for {{job}} has been confirmed on AgroTalent Hub. Check your dashboard for details.',
    recipients: [{
      [phone]: {
        name: graduateName,
        farm: farmName,
        job: jobTitle,
      }
    }],
    campaignName: 'Placement Confirmed',
  })
}

export async function sendVerificationApprovedSms(
  userPhone: string,
  userName: string
): Promise<void> {
  const phone = formatPhone(userPhone)
  await sendSms({
    message: 'Hello {{name}}, your AgroTalent Hub account has been verified! You now have full access to the platform. Visit agrotalenthub.com to get started.',
    recipients: [{
      [phone]: {
        name: userName,
      }
    }],
    campaignName: 'Account Verified',
  })
}

export async function sendTrainingScheduledSms(
  participantPhone: string,
  participantName: string,
  sessionTitle: string,
  scheduledAt: string
): Promise<void> {
  const phone = formatPhone(participantPhone)
  await sendSms({
    message: 'Hi {{name}}, a training session "{{session}}" has been scheduled for {{date}} on AgroTalent Hub. Check your dashboard for details.',
    recipients: [{
      [phone]: {
        name: participantName,
        session: sessionTitle,
        date: scheduledAt,
      }
    }],
    campaignName: 'Training Scheduled',
  })
}

export async function sendDocumentReviewedSms(
  userPhone: string,
  userName: string,
  documentType: string,
  status: 'approved' | 'rejected'
): Promise<void> {
  const phone = formatPhone(userPhone)
  const message = status === 'approved'
    ? 'Hi {{name}}, your {{doc}} document has been approved on AgroTalent Hub.'
    : 'Hi {{name}}, your {{doc}} document was not approved. Please log in to upload a new one.'
  await sendSms({
    message,
    recipients: [{
      [phone]: {
        name: userName,
        doc: documentType,
      }
    }],
    campaignName: 'Document Review',
  })
}

export async function sendPaymentConfirmedSms(
  farmPhone: string,
  farmName: string,
  amount: number,
  currency: string,
  jobTitle: string
): Promise<void> {
  const phone = formatPhone(farmPhone)
  await sendSms({
    message: 'Hi {{name}}, your payment of {{amount}} {{currency}} for {{job}} has been confirmed on AgroTalent Hub.',
    recipients: [{
      [phone]: {
        name: farmName,
        amount: amount.toString(),
        currency,
        job: jobTitle,
      }
    }],
    campaignName: 'Payment Confirmed',
  })
}
