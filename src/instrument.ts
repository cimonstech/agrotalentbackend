// IMPORTANT: this file must be the very first thing Node loads, BEFORE express
// or any of our route modules. With ESM, all `import` statements in server.ts
// run before its top-level code, so calling Sentry.init() inside server.ts is
// too late for @sentry/node v8 auto-instrumentation. We load this via
// `node --import ./dist/instrument.js` in the start script (see package.json).

import 'dotenv/config'
import * as Sentry from '@sentry/node'

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1,
    sendDefaultPii: false,
  })
}
