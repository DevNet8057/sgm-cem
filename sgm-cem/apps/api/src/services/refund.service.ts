// Remboursements (lot 4.1 — M16) : écritures compensatoires. Une contribution
// confirmée n'est jamais modifiée ; seuls les remboursements EXÉCUTÉS viennent
// en déduction des totaux (rubriques, membre, position des fonds, statistiques),
// à la date de leur exécution.
import type { LocalisationFonds, Prisma, PrismaClient } from '@prisma/client'
import { getPrisma } from '../lib/prisma'

const prisma = getPrisma()
type Db = PrismaClient | Prisma.TransactionClient

/** Emplacements d'où le trésorier peut rendre l'argent. */
export const REFUND_SOURCES = ['REMIS_TRESORIER', 'EN_CAISSE', 'PORTEFEUILLE_ELECTRONIQUE', 'EN_BANQUE'] as const satisfies readonly LocalisationFonds[]

/** Montant encore remboursable : contribution moins les remboursements non rejetés ni annulés. */
export async function refundableAmount(db: Db, contribution: { id: string; montant: number }): Promise<number> {
  const agg = await db.remboursement.aggregate({
    where: { contributionId: contribution.id, statut: { in: ['DEMANDE', 'VALIDE', 'EXECUTE'] } },
    _sum: { montant: true },
  })
  return contribution.montant - (agg._sum.montant ?? 0)
}

function executedWhere(extra: Prisma.RemboursementWhereInput = {}, period?: { gte?: Date; lte?: Date }): Prisma.RemboursementWhereInput {
  return { statut: 'EXECUTE', ...(period ? { executedAt: period } : {}), ...extra }
}

/** Remboursements exécutés par rubrique (optionnellement sur une période d'exécution). */
export async function refundsByRubrique(period?: { gte?: Date; lte?: Date }, extra: Prisma.RemboursementWhereInput = {}): Promise<Map<string, number>> {
  const rows = await prisma.remboursement.groupBy({ by: ['rubriqueId'], where: executedWhere(extra, period), _sum: { montant: true } })
  return new Map(rows.map(r => [r.rubriqueId, r._sum.montant ?? 0]))
}

/** Total des remboursements exécutés (période d'exécution facultative). */
export async function refundsTotal(period?: { gte?: Date; lte?: Date }, extra: Prisma.RemboursementWhereInput = {}): Promise<number> {
  const agg = await prisma.remboursement.aggregate({ where: executedWhere(extra, period), _sum: { montant: true } })
  return agg._sum.montant ?? 0
}

/** Argent sorti par emplacement, remboursements exécutés jusqu'à `at` inclus. */
export async function refundsByLocation(db: Db, at?: Date): Promise<Map<string, number>> {
  const rows = await db.remboursement.groupBy({
    by: ['sourceLocation'], where: executedWhere({}, at ? { lte: at } : undefined), _sum: { montant: true },
  })
  return new Map(rows.filter(r => r.sourceLocation).map(r => [r.sourceLocation as string, r._sum.montant ?? 0]))
}

/** Déduit des sommes par emplacement l'argent rendu depuis chacun (remboursements exécutés). */
export async function netLocationGroups<T extends { localisationFonds: string; _sum: { montant: number | null } }>(groups: T[]): Promise<T[]> {
  const out = await refundsByLocation(prisma)
  if (out.size === 0) return groups
  const netted: T[] = groups.map(g => ({ ...g, _sum: { ...g._sum, montant: (g._sum.montant ?? 0) - (out.get(g.localisationFonds) ?? 0) } }))
  // Emplacement vidé entre-temps : la sortie reste visible (montant négatif = écart à examiner)
  for (const [location, amount] of out) {
    if (!groups.some(g => g.localisationFonds === location)) netted.push({ localisationFonds: location, _sum: { montant: -amount } } as unknown as T)
  }
  return netted
}
