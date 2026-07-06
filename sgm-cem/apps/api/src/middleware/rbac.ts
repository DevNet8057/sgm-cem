import type { Request, Response, NextFunction } from 'express'
import { AppError } from './errorHandler'

const ROLE_LEVELS: Record<string, number> = {
  DEVELOPER: 6,
  ADMIN: 5,
  TRESORIER: 4,
  RESPONSABLE: 3,
  ADJOINT_RESPONSABLE: 3,
  COLLECTEUR: 2,
  MEMBRE: 1,
}

export const requireLevel = (minLevel: number) =>
  (_req: Request, _res: Response, next: NextFunction) => {
    const req = _req
    const role = req.user?.role ?? ''
    const level = ROLE_LEVELS[role] ?? 0

    if (level < minLevel) {
      const minRole = Object.entries(ROLE_LEVELS)
        .filter(([_, l]) => l >= minLevel)
        .map(([r]) => r)
        .sort()
        .join(', ')

      throw new AppError(
        'INSUFFICIENT_PERMISSIONS',
        `Rôle insuffisant. Rôles requis: ${minRole}`,
        403
      )
    }
    next()
  }

export const requireRole = (...roles: string[]) =>
  (_req: Request, _res: Response, next: NextFunction) => {
    const req = _req
    if (!roles.includes(req.user?.role ?? '')) {
      throw new AppError(
        'INSUFFICIENT_PERMISSIONS',
        `Rôle requis : ${roles.join(' ou ')}`,
        403
      )
    }
    next()
  }

// Panneau développeur (DEVELOPER_PANEL_SGM_CEM.md) — DEVELOPER uniquement.
// Ne JAMAIS remplacer par requireLevel(5) : même ADMIN ne doit pas y accéder.
export const requireDeveloper = requireRole('DEVELOPER')
