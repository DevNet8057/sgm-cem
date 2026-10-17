// Autorisation de substitution (lot 4.4 — EF-M06-06, RG-15) : un administrateur
// autorise nominativement un trésorier à confirmer UNE contribution attribuée à
// un autre collecteur, avec motif et échéance. Consommée à l'usage, révocable.
import type { Prisma, PrismaClient } from '@prisma/client'
import { getPrisma } from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import type { ContributionConfirmationAuthorization } from '@sgm-cem/shared'
import { parseConfirmationAuthorization } from './contribution-access.service'

const prisma = getPrisma()
const GRANTER_ROLES = new Set(['ADMIN', 'DEVELOPER'])

type WithAuthorization = { id: string; confirmationAuthorization?: unknown }

/**
 * Contributions dont l'autorisation reste portée par des comptes valides :
 * trésorier actif (toujours trésorier) et administrateur actif. Un compte
 * désactivé ou changé de rôle rend l'autorisation sans effet.
 */
export async function validAuthorizationIds(records: WithAuthorization[], client: PrismaClient = prisma): Promise<Set<string>> {
  const parsed = records
    .map(r => ({ id: r.id, auth: parseConfirmationAuthorization(r.confirmationAuthorization) }))
    .filter((r): r is { id: string; auth: ContributionConfirmationAuthorization } => r.auth !== null)
  if (parsed.length === 0) return new Set()
  const userIds = Array.from(new Set(parsed.flatMap(r => [r.auth.treasurerId, r.auth.grantedById])))
  const users = new Map((await client.user.findMany({
    where: { id: { in: userIds } }, select: { id: true, role: true, isActive: true },
  })).map(u => [u.id, u]))
  return new Set(parsed.filter(({ auth }) => {
    const treasurer = users.get(auth.treasurerId)
    const granter = users.get(auth.grantedById)
    return Boolean(treasurer?.isActive && treasurer.role === 'TRESORIER' && granter?.isActive && GRANTER_ROLES.has(granter.role))
  }).map(r => r.id))
}

export async function authorizationActorsValid(record: WithAuthorization): Promise<boolean> {
  return (await validAuthorizationIds([record])).has(record.id)
}

// Ligne verrouillée jusqu'à la fin de la transaction : une révocation et une
// confirmation simultanées ne peuvent pas réussir toutes les deux
async function lockAuthorization(tx: Prisma.TransactionClient, contributionId: string): Promise<ContributionConfirmationAuthorization | null> {
  const rows = await tx.$queryRaw<Array<{ confirmationAuthorization: unknown }>>`
    SELECT "confirmationAuthorization" FROM "contributions" WHERE "id" = ${contributionId} FOR UPDATE`
  return parseConfirmationAuthorization(rows[0]?.confirmationAuthorization)
}

/**
 * Consomme l'autorisation du trésorier dans la transaction de confirmation.
 * Lève une erreur (et annule la confirmation) si elle a été révoquée, a expiré
 * ou a déjà servi entre-temps.
 */
export async function consumeAuthorization(tx: Prisma.TransactionClient, contributionId: string, treasurerId: string, now = new Date()): Promise<ContributionConfirmationAuthorization> {
  const auth = await lockAuthorization(tx, contributionId)
  if (!auth || auth.treasurerId !== treasurerId || auth.consumedAt || auth.revokedAt || new Date(auth.expiresAt) <= now) {
    throw new AppError('FORBIDDEN', 'Autorisation de confirmation expirée, révoquée ou déjà utilisée.', 403)
  }
  const consumed = { ...auth, consumedAt: now.toISOString() }
  await tx.contribution.update({ where: { id: contributionId }, data: { confirmationAuthorization: consumed } })
  return consumed
}

/** Révocation d'une autorisation encore utilisable. */
export async function revokeAuthorization(tx: Prisma.TransactionClient, contributionId: string, now = new Date()): Promise<ContributionConfirmationAuthorization> {
  const auth = await lockAuthorization(tx, contributionId)
  if (!auth || auth.consumedAt || auth.revokedAt) {
    throw new AppError('BUSINESS_RULE', 'Aucune autorisation en cours sur cette contribution.', 400)
  }
  const revoked = { ...auth, revokedAt: now.toISOString() }
  await tx.contribution.update({ where: { id: contributionId }, data: { confirmationAuthorization: revoked } })
  return revoked
}
