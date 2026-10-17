import pino from 'pino'

// Journaux JSON (une ligne par événement) ; jamais de secret ni de jeton :
// les en-têtes d'authentification et cookies sont masqués.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: 'sgm-cem-api' },
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]', '*.password', '*.passwordHash'],
    censor: '[masqué]',
  },
})

/** Applique le niveau configuré dans le panneau développeur (LOG_LEVEL). */
export function applyLogLevel(level: string | undefined): void {
  if (level && level in logger.levels.values) logger.level = level
}
