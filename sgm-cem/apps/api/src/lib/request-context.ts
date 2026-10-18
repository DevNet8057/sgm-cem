// Contexte de la requête en cours (AsyncLocalStorage) : le journal d'audit y lit
// l'adresse IP, le navigateur et l'auteur réel sous impersonation, sans que
// chaque écriture d'audit ait à les passer (EF-M13-01).
import { AsyncLocalStorage } from 'async_hooks'
import type { NextFunction, Request, Response } from 'express'

const storage = new AsyncLocalStorage<{ req: Request }>()

export function requestContext(req: Request, _res: Response, next: NextFunction): void {
  storage.run({ req }, next)
}

/** Champs de traçabilité de la requête en cours ; vide hors requête (tâches planifiées). */
export function currentAuditMeta(): { ipAddress?: string | null; userAgent?: string | null; impersonatedById?: string | null } {
  const req = storage.getStore()?.req
  if (!req) return {}
  const impersonatedBy = (req as Request & { user?: { impersonatedBy?: string } }).user?.impersonatedBy
  return {
    ipAddress: req.ip ?? null,
    userAgent: (req.headers['user-agent'] ?? '').slice(0, 255) || null,
    impersonatedById: impersonatedBy ?? null,
  }
}
