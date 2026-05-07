import { logCommunication } from './logCommunication.js'
import * as Sentry from '@sentry/node'

interface NotifyOptions {
  event_type?: string
  channel?: 'email' | 'sms' | 'both'
  recipient_email?: string | null
  recipient_phone?: string | null
  subject?: string | null
  message?: string
  related_job_id?: string | null
  related_user_id?: string | null
  triggered_by?: 'system' | 'admin' | 'cron'
}

type NotifyFn = () => Promise<unknown>

export function fireAndForget(
  fn: NotifyFn,
  context?: string,
  options?: NotifyOptions
): void {
  void fn()
    .then(() => {
      if (options?.event_type) {
        const ch = options.channel ?? 'email'
        void logCommunication({
          type: ch === 'sms' ? 'sms' : 'email',
          channel: ch,
          event_type: options.event_type,
          recipient_email: options.recipient_email,
          recipient_phone: options.recipient_phone,
          subject: options.subject,
          message: options.message ?? context ?? '',
          status: 'sent',
          related_job_id: options.related_job_id,
          related_user_id: options.related_user_id,
          triggered_by: options.triggered_by ?? 'system',
        })
      }
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[notify] ${context ?? 'notification'} failed:`, message)
      Sentry.captureException(err, {
        extra: { context: context ?? 'notification' },
      })
      if (options?.event_type) {
        const ch = options.channel ?? 'email'
        void logCommunication({
          type: ch === 'sms' ? 'sms' : 'email',
          channel: ch,
          event_type: options.event_type,
          recipient_email: options.recipient_email,
          recipient_phone: options.recipient_phone,
          subject: options.subject,
          message: options.message ?? context ?? '',
          status: 'failed',
          related_job_id: options.related_job_id,
          related_user_id: options.related_user_id,
          triggered_by: options.triggered_by ?? 'system',
          error_details: message,
        })
      }
    })
}
