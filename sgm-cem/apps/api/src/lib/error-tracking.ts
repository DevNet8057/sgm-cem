import { logger } from './logger'

// Suivi d'erreurs facultatif (Sentry ou GlitchTip compatible) : actif seulement
// si SENTRY_DSN est défini — aucune donnée n'est envoyée sinon.
type SentryLike = { captureException: (error: unknown, context?: { extra?: Record<string, unknown> }) => void }
let sentry: SentryLike | null = null

export function initErrorTracking(): void {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require('@sentry/node') as typeof import('@sentry/node')
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    release: process.env.APP_VERSION,
    tracesSampleRate: 0,
    // Par défaut le SDK n'envoie ni IP ni cookies ni corps de requête (loi n° 2024/017)
  })
  sentry = Sentry
  logger.info('Suivi d’erreurs activé')
}

export function captureError(error: unknown, extra?: Record<string, unknown>): void {
  sentry?.captureException(error, extra ? { extra } : undefined)
}
