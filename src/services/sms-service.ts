import axios from 'axios'
import { getSupabaseAdminClient } from '../lib/supabase.js'

const FISH_AFRICA_BASE_URL = 'https://api.letsfish.africa/v1'

function getSmsConfig() {
  const appId = process.env.FISH_AFRICA_APP_ID ?? ''
  const appSecret = process.env.FISH_AFRICA_APP_SECRET ?? ''
  const auth = appId + '.' + appSecret
  const senderId = (process.env.FISH_AFRICA_SENDER_ID ?? 'AgroTalentH').trim()
  return { appId, appSecret, auth, senderId }
}

interface SmsRecipient {
  [phoneNumber: string]: Record<string, string>
}

interface SendSmsParams {
  message: string
  recipients: SmsRecipient[]
  campaignName?: string
}

async function sendSms(params: SendSmsParams): Promise<void> {
  const { appId, appSecret, auth, senderId } = getSmsConfig()

  if (!appId || !appSecret) {
    console.warn('[SMS] Not configured')
    return
  }

  for (const recipientObj of params.recipients) {
    const phone = Object.keys(recipientObj)[0]
    const variables = recipientObj[phone] as Record<string, string>

    let interpolatedMessage = params.message
    for (const [key, value] of Object.entries(variables)) {
      interpolatedMessage = interpolatedMessage.replace(
        new RegExp('\\{\\{' + key + '\\}\\}', 'g'),
        value
      )
    }

    console.log('[SMS] Sending to:', phone)
    console.log('[SMS] Message:', interpolatedMessage)

    try {
      const response = await axios.post(
        FISH_AFRICA_BASE_URL + '/sms',
        {
          campaign_name: params.campaignName ?? 'AgroTalent',
          sender_id: senderId,
          message: interpolatedMessage,
          recipients: [phone],
        },
        {
          headers: {
            Authorization: 'Bearer ' + auth,
            'Content-Type': 'application/json',
          },
        }
      )

      console.log('[SMS] Success:', response.status, JSON.stringify(response.data))

      try {
        const supabase = getSupabaseAdminClient()
        await supabase.from('email_logs').insert({
          recipient_email: 'sms:' + phone,
          subject: params.campaignName ?? 'SMS',
          type: 'sms',
          status: 'sent',
          sent_at: new Date().toISOString(),
          metadata: { channel: 'sms', phone },
        })
      } catch (logErr) {
        console.error('[SMS] Log error:', logErr)
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        console.error('[SMS] Failed:', JSON.stringify(err.response?.data ?? err.message))
      } else {
        console.error('[SMS] Failed:', err instanceof Error ? err.message : String(err))
      }
    }
  }
}

function formatPhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-\+]/g, '')
  if (cleaned.startsWith('0')) return '233' + cleaned.slice(1)
  if (cleaned.startsWith('233')) return cleaned
  return '233' + cleaned
}

export type SendRawSmsResult = { success: boolean; error?: string }

/**
 * Plain-text SMS (admin broadcasts, etc.). Uses Fish Africa template API with a single merge field.
 */
export async function sendRawSms(
  phone: string,
  message: string,
  campaignName = 'Admin Communications'
): Promise<SendRawSmsResult> {
  const { appId, appSecret, auth, senderId } = getSmsConfig()
  if (!appId || !appSecret) {
    console.warn('[SMS] Not configured')
    return { success: false, error: 'SMS not configured' }
  }

  const formattedPhone = formatPhone(phone)
  console.log('[SMS Raw] Sending to:', formattedPhone, '| Message:', message.substring(0, 60))

  try {
    const response = await axios.post(
      FISH_AFRICA_BASE_URL + '/sms',
      {
        campaign_name: campaignName ?? 'AgroTalent',
        sender_id: senderId,
        message: message,
        recipients: [formattedPhone],
      },
      {
        headers: {
          Authorization: 'Bearer ' + auth,
          'Content-Type': 'application/json',
        },
      }
    )
    console.log('[SMS Raw] Success:', response.status, JSON.stringify(response.data))
    try {
      const supabase = getSupabaseAdminClient()
      await supabase.from('email_logs').insert({
        recipient_email: 'sms:' + formattedPhone,
        subject: campaignName ?? 'SMS',
        type: 'sms',
        status: 'sent',
        sent_at: new Date().toISOString(),
        metadata: { channel: 'sms', phone: formattedPhone },
      })
    } catch (logErr) {
      console.error('[SMS] Log error:', logErr)
    }
    return { success: true }
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const msg = JSON.stringify(err.response?.data ?? err.message)
      console.error('[SMS Raw] Failed:', msg)
      return { success: false, error: msg }
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[SMS Raw] Failed:', msg)
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
