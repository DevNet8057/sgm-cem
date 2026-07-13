import { PrismaClient, type AuditAction, type Prisma } from '@prisma/client'
import type { Request } from 'express'

const prisma = new PrismaClient()

// Métadonnées de traçabilité extraites de la requête HTTP.
// x-forwarded-for d'abord : derrière un reverse proxy, req.ip est celle du proxy.
export function requestMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
  return {
    ipAddress: forwarded ?? req.ip ?? null,
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
}): Promise<void> {
  try {
    await prisma.auditLog.create({
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
  }
}
