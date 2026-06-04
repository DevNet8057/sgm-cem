import type { Request, Response, NextFunction } from 'express'
import { AppError } from './errorHandler'

const ROLE_LEVELS: Record<string, number> = {
  ADMIN: 5, TRESORIER: 4, RESPONSABLE: 3,
  ADJOINT_RESPONSABLE: 3, COLLECTEUR: 2, MEMBRE: 1,
}

export const requireLevel = (minLevel: number) =>
  (_req: Request, _res: Response, next: NextFunction) => {
    const req = _req
    const level = ROLE_LEVELS[req.user?.role ?? ''] ?? 0
    if (level < minLevel) throw new AppError('ACCESS_DENIED', 'Niveau de permission insuffisant', 403)
    next()
  }

export const requireRole = (...roles: string[]) =>
  (_req: Request, _res: Response, next: NextFunction) => {
    const req = _req
    if (!roles.includes(req.user?.role ?? '')) {
      throw new AppError('ACCESS_DENIED', `Rôle requis : ${roles.join(' ou ')}`, 403)
    }
    next()
  }
