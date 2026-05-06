import * as Sentry from '@sentry/node'

type NotifyFn = () => Promise<unknown>

/**
 * Runs an async notification function (email or SMS) in the background.
 * The caller returns immediately. Errors are logged to Sentry.
 */
export function fireAndForget(fn: NotifyFn, context?: string): void {
  void fn().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[notify] ${context ?? 'notification'} failed:`, message)
    Sentry.captureException(err, {
      extra: { context: context ?? 'notification' },
    })
  })
}

