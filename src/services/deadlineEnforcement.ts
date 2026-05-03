import { getSupabaseAdminClient } from '../lib/supabase.js'
import { sendNotificationEmail } from './email-service.js'
import { sendRawSms } from './sms-service.js'

interface JobProfiles {
  full_name?: string | null
  farm_name?: string | null
  email?: string | null
  phone?: string | null
}

interface JobToClose {
  id: string
  title: string
  application_deadline: string
  location: string
  profiles: JobProfiles | JobProfiles[] | null
}

function profileOne(p: JobToClose['profiles']): JobProfiles | null {
  if (!p) return null
  return Array.isArray(p) ? (p[0] ?? null) : p
}

export async function enforceApplicationDeadlines(): Promise<{
  closed: number
  errors: string[]
}> {
  const supabase = getSupabaseAdminClient()
  const errors: string[] = []
  let closed = 0

  const { data: jobs, error: fetchError } = await supabase
    .from('jobs')
    .select(
      `
      id,
      title,
      application_deadline,
      location,
      profiles:farm_id (
        full_name,
        farm_name,
        email,
        phone
      )
    `
    )
    .eq('status', 'active')
    .is('deleted_at', null)
    .is('hidden_at', null)
    .not('application_deadline', 'is', null)
    .lt('application_deadline', new Date().toISOString())

  if (fetchError) {
    return { closed: 0, errors: [fetchError.message] }
  }

  if (!jobs || jobs.length === 0) {
    return { closed: 0, errors: [] }
  }

  for (const job of jobs as JobToClose[]) {
    try {
      const { error: updateError } = await supabase
        .from('jobs')
        .update({
          status: 'closed',
          closed_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      if (updateError) {
        errors.push(`Job ${job.id}: ${updateError.message}`)
        continue
      }

      closed++

      const farm = profileOne(job.profiles)
      const contactName = farm?.full_name ?? 'Farm Manager'

      const emailAddr = farm?.email?.trim()
      if (emailAddr) {
        try {
          const messageBody =
            `Hi ${contactName},\n\n` +
            `The application deadline for your job posting "${job.title}" (${job.location}) has passed.\n\n` +
            'The listing has been automatically closed. You can log in to your AgroTalentHub dashboard to review applications or repost the job.\n\n' +
            'Thank you for using AgroTalentHub.'
          const result = await sendNotificationEmail(
            emailAddr,
            `Application deadline passed - ${job.title}`,
            messageBody,
            contactName,
            {
              role: 'farm',
              ctaText: 'Open dashboard',
              ctaUrl: '/dashboard/farm/jobs',
            }
          )
          if (!result.success) {
            errors.push(`Job ${job.id} email: ${result.error ?? 'send failed'}`)
          }
        } catch (emailErr) {
          errors.push(
            `Job ${job.id} email: ${
              emailErr instanceof Error ? emailErr.message : String(emailErr)
            }`
          )
        }
      }

      const phoneRaw = farm?.phone?.trim()
      if (phoneRaw) {
        try {
          const smsResult = await sendRawSms(
            phoneRaw,
            `AgroTalentHub: Your job "${job.title}" has been closed as the application deadline has passed. Log in to review applications or repost. agrotalenthub.com`,
            'Deadline enforcement'
          )
          if (!smsResult.success) {
            errors.push(`Job ${job.id} SMS: ${smsResult.error ?? 'send failed'}`)
          }
        } catch (smsErr) {
          errors.push(
            `Job ${job.id} SMS: ${
              smsErr instanceof Error ? smsErr.message : String(smsErr)
            }`
          )
        }
      }

      try {
        await supabase.from('communication_logs').insert({
          type: 'email',
          recipients: 'single',
          subject: 'Deadline enforcement',
          message: `Job "${job.title}" auto-closed - application deadline passed.`,
          recipient_count: 1,
          success_count: 1,
          failure_count: 0,
          status: 'sent',
          error_details: { job_id: job.id, deadline: job.application_deadline },
        })
      } catch {
        // Non-critical
      }
    } catch (jobErr) {
      errors.push(
        `Job ${job.id}: ${
          jobErr instanceof Error ? jobErr.message : String(jobErr)
        }`
      )
    }
  }

  return { closed, errors }
}
