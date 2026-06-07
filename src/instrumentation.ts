export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
}

// Forwards unhandled server-component errors to Sentry automatically.
// No-op when SENTRY_DSN is not set.
export { onRequestError } from '@sentry/nextjs'
