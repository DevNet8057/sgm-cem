import { type AuditAction, type Prisma } from '@prisma/client'
import type { Request } from 'express'
import { getPrisma } from '../lib/prisma'

const prisma = getPrisma()

// Métadonnées de traçabilité extraites de la requête HTTP. req.ip tient compte
// de « trust proxy » : x-forwarded-for brut serait falsifiable par le client.
export function requestMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  return {
    ipAddress: req.ip ?? null,
    userAgent: (req.headers['user-agent'] ?? '').slice(0, 255) || null,
  }
}

/**
 * Écrit une entrée dans le journal d'audit (« qui a fait quoi »).
 * Best-effort : un échec d'écriture ne doit JAMAIS faire échouer
 * l'opération métier auditée — il est loggé côté serveur uniquement.
 */
export async function audit(p: {
  req?: Request
  userId: string
  userName: string
  action: AuditAction
  entityType: string
  entityId?: string | null
  details?: Prisma.InputJsonValue
}, options?: {
  client?: Pick<Prisma.TransactionClient, 'auditLog'>
  strict?: boolean
}): Promise<void> {
  try {
    await (options?.client ?? prisma).auditLog.create({
      data: {
        userId: p.userId,
        userName: p.userName,
        action: p.action,
        entityType: p.entityType,
        entityId: p.entityId ?? null,
        details: p.details,
        ...(p.req ? requestMeta(p.req) : {}),
      },
    })
  } catch (e) {
    console.error('[Audit] écriture impossible :', e)
    if (options?.strict) throw e
  }
}
