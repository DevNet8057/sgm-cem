// Mode maintenance (lot 4.5 — EF-M14-03) : MAINTENANCE_MODE=true (panneau
// développeur, effet immédiat) bloque toutes les écritures sauf pour le
// DEVELOPER ; la lecture, la connexion et les webhooks des prestataires
// (montés hors de /api) continuent : aucun paiement confirmé n'est perdu.
import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { getConfig } from '../services/config.service'
import { getJwtSecret } from '../lib/security'
import { extractAccessToken } from './auth'

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const ALWAYS_ALLOWED = ['/auth/', '/activity/', '/csrf-token']
const DEFAULT_MESSAGE = 'Maintenance en cours — merci de réessayer dans quelques minutes.'

export function maintenanceStatus(): { maintenance: boolean; message: string } {
  return {
    maintenance: getConfig('MAINTENANCE_MODE') === 'true',
    message: getConfig('MAINTENANCE_MESSAGE') || DEFAULT_MESSAGE,
  }
}

// Le développeur (ou un développeur connecté « en tant que ») garde la main
function isDeveloper(req: Request): boolean {
  const token = extractAccessToken(req)
  if (!token) return false
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { role?: string; impersonatedBy?: string }
    return payload.role === 'DEVELOPER' || Boolean(payload.impersonatedBy)
  } catch {
    return false
  }
}

export function maintenanceGuard(req: Request, res: Response, next: NextFunction): void {
  if (READ_METHODS.has(req.method)) return next()
  const { maintenance, message } = maintenanceStatus()
  if (!maintenance || ALWAYS_ALLOWED.some(p => req.path.startsWith(p)) || isDeveloper(req)) return next()
  res.setHeader('Retry-After', '300')
  res.status(503).json({ success: false, error: { code: 'MAINTENANCE', message } })
}
