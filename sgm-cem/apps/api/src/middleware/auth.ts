import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { AppError } from './errorHandler'
import { getJwtSecret } from '../lib/security'
import { checkSession } from '../lib/session'

interface JwtPayload {
  userId: string
  role: string
  email: string
  // Session (UserSession.id) qui a émis le jeton : sa suppression révoque l'accès.
  sid?: string
  // Présent uniquement quand un DEVELOPER est connecté "en tant que" cet
  // utilisateur (impersonation) — contient l'id du développeur initiateur.
  impersonatedBy?: string
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

// Routes accessibles tant que le mot de passe temporaire n'a pas été changé
const PASSWORD_CHANGE_ALLOWED = ['/api/auth/', '/api/activity/']

export function extractAccessToken(req: Request): string | undefined {
  // Cookie HttpOnly prioritaire ; en-tête Authorization pour les clients API
  const cookieToken: string | undefined = req.cookies?.access_token
  const header = req.headers.authorization
  return cookieToken ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined)
}

/** Vérifie la signature du jeton puis l'état réel de la session et du compte. */
export async function verifyAccessToken(token: string): Promise<JwtPayload & { mustChangePassword: boolean }> {
  let payload: JwtPayload
  try {
    payload = jwt.verify(token, getJwtSecret()) as JwtPayload
  } catch (error) {
    const msg = error instanceof jwt.TokenExpiredError ? 'Token expiré' : 'Token invalide'
    throw new AppError('ACCESS_DENIED', msg, 401)
  }
  // Jetons antérieurs à la gestion des sessions : 401 → le client rafraîchit
  if (!payload.sid) throw new AppError('ACCESS_DENIED', 'Session expirée', 401)

  const state = await checkSession(payload.sid, payload.userId, payload.impersonatedBy ?? payload.userId)
  if (!state.valid) throw new AppError('ACCESS_DENIED', 'Session expirée', 401)

  // Un changement de rôle ferme les sessions du compte (routes/users.ts) : le rôle du jeton reste fiable
  return { ...payload, mustChangePassword: state.mustChangePassword }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractAccessToken(req)
  if (!token) throw new AppError('ACCESS_DENIED', 'Token manquant', 401)

  const { mustChangePassword, ...user } = await verifyAccessToken(token)
  req.user = user

  if (mustChangePassword && !user.impersonatedBy && !PASSWORD_CHANGE_ALLOWED.some(p => req.originalUrl.startsWith(p))) {
    throw new AppError('PASSWORD_CHANGE_REQUIRED', 'Vous devez changer votre mot de passe avant de continuer', 403)
  }
  next()
}
