import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { AppError } from './errorHandler'
import { getJwtSecret } from '../lib/security'

interface JwtPayload {
  userId: string
  role: string
  email: string
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) throw new AppError('ACCESS_DENIED', 'Token manquant', 401)

  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, getJwtSecret()) as JwtPayload
    req.user = payload
    next()
  } catch {
    throw new AppError('ACCESS_DENIED', 'Token invalide ou expiré', 401)
  }
}
