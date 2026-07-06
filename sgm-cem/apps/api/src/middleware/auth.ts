import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { AppError } from './errorHandler'
import { getJwtSecret } from '../lib/security'

interface JwtPayload {
  userId: string
  role: string
  email: string
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

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  // Cookie HttpOnly takes priority; fall back to Authorization header for API clients
  const cookieToken: string | undefined = req.cookies?.access_token
  const header = req.headers.authorization
  const token = cookieToken ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined)

  if (!token) throw new AppError('ACCESS_DENIED', 'Token manquant', 401)

  try {
    const payload = jwt.verify(token, getJwtSecret()) as JwtPayload
    req.user = payload
    next()
  } catch (error) {
    const msg = error instanceof jwt.TokenExpiredError ? 'Token expiré' : 'Token invalide'
    throw new AppError('ACCESS_DENIED', msg, 401)
  }
}
