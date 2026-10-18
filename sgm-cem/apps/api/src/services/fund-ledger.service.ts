// Grand livre des fonds (lot 3.3, ADR-004) : tout changement d'emplacement de
// l'argent passe par ce service, dans la même transaction que la mise à jour
// de la contribution. Les lignes ne sont jamais modifiées ni supprimées.
import type { FundMovementReason, LocalisationFonds, ModePaiement, Prisma, PrismaClient } from '@prisma/client'
import { AppError } from '../middleware/errorHandler'
import { refundsByLocation } from './refund.service'

type Tx = Prisma.TransactionClient

// Transitions permises (RG-21). ENTREE : l'argent entre dans le circuit à la confirmation.
const ALLOWED: Record<LocalisationFonds | 'ENTREE', readonly LocalisationFonds[]> = {
  ENTREE: ['CHEZ_COLLECTEUR', 'REMIS_TRESORIER', 'PORTEFEUILLE_ELECTRONIQUE'],
  CHEZ_COLLECTEUR: ['EN_TRANSIT'],
  CHEZ_RESPONSABLE: ['EN_TRANSIT'],
  EN_TRANSIT: ['CHEZ_COLLECTEUR', 'CHEZ_RESPONSABLE', 'REMIS_TRESORIER'],
  REMIS_TRESORIER: ['EN_CAISSE', 'EN_BANQUE'],
  EN_CAISSE: ['EN_BANQUE'],
  PORTEFEUILLE_ELECTRONIQUE: ['EN_BANQUE'],
  EN_BANQUE: [],
  HORS_CIRCUIT: [],
}

/** Emplacements d'où l'argent d'un litige peut sortir du circuit (ceux où un litige est permis). */
const DISPUTE_EXIT_FROM: readonly LocalisationFonds[] = ['CHEZ_COLLECTEUR', 'PORTEFEUILLE_ELECTRONIQUE', 'EN_TRANSIT']

/** Emplacements d'où un détenteur peut remettre l'argent à quelqu'un d'autre. */
export const TRANSFERABLE_LOCATIONS = ['CHEZ_COLLECTEUR', 'CHEZ_RESPONSABLE'] as const satisfies readonly LocalisationFonds[]

/** Emplacements déposables en banque (avec reçu de dépôt). */
export const DEPOSITABLE_LOCATIONS = ['REMIS_TRESORIER', 'EN_CAISSE', 'PORTEFEUILLE_ELECTRONIQUE'] as const satisfies readonly LocalisationFonds[]

const ELECTRONIC_MODES: readonly ModePaiement[] = ['MTN_MOMO', 'ORANGE_MONEY', 'YELII', 'CARTE_VISA']

export function isTransitionAllowed(from: LocalisationFonds | null, to: LocalisationFonds, reason?: FundMovementReason): boolean {
  // La sortie du circuit est réservée à l'annulation d'un litige, et inversement
  if (reason === 'ANNULATION_LITIGE' || to === 'HORS_CIRCUIT') {
    return reason === 'ANNULATION_LITIGE' && to === 'HORS_CIRCUIT' && from !== null && DISPUTE_EXIT_FROM.includes(from)
  }
  return ALLOWED[from ?? 'ENTREE'].includes(to)
}

/**
 * Où entre l'argent à la confirmation (décision du Bureau du 17/10/2026) :
 * espèces chez celui qui les a reçues, virement chez le trésorier,
 * paiement électronique sur le portefeuille électronique.
 */
export function entryPoint(c: { modePaiement: ModePaiement; collecteurId: string | null }): { location: LocalisationFonds; holderId: string | null } {
  if (ELECTRONIC_MODES.includes(c.modePaiement)) return { location: 'PORTEFEUILLE_ELECTRONIQUE', holderId: null }
  if (c.modePaiement === 'VIREMENT') return { location: 'REMIS_TRESORIER', holderId: null }
  return { location: 'CHEZ_COLLECTEUR', holderId: c.collecteurId }
}

/** Emplacement des fonds reçus, selon le rôle du destinataire (RG-22). */
export function receptionLocation(role: string): LocalisationFonds {
  if (['ADMIN', 'DEVELOPER', 'TRESORIER'].includes(role)) return 'REMIS_TRESORIER'
  if (['RESPONSABLE', 'ADJOINT_RESPONSABLE'].includes(role)) return 'CHEZ_RESPONSABLE'
  return 'CHEZ_COLLECTEUR'
}

export interface MovementInput {
  contributionId: string
  montant: number
  from: LocalisationFonds | null
  to: LocalisationFonds
  holderFromId?: string | null
  holderToId?: string | null
  reason: FundMovementReason
  transferId?: string | null
  bankDepositId?: string | null
  actorId?: string | null
}

/** Écrit des mouvements ; refuse toute transition hors RG-21 (la transaction est annulée). */
export async function recordMovements(tx: Tx, movements: MovementInput[]): Promise<void> {
  if (movements.length === 0) return
  for (const m of movements) {
    if (!isTransitionAllowed(m.from, m.to, m.reason)) {
      throw new AppError('BUSINESS_RULE', `Mouvement de fonds interdit : ${m.from ?? 'entrée'} → ${m.to}`, 409)
    }
  }
  await tx.fundMovement.createMany({
    data: movements.map(m => ({
      contributionId: m.contributionId,
      montant: m.montant,
      fromLocation: m.from,
      toLocation: m.to,
      holderFromId: m.holderFromId ?? null,
      holderToId: m.holderToId ?? null,
      reason: m.reason,
      transferId: m.transferId ?? null,
      bankDepositId: m.bankDepositId ?? null,
      actorId: m.actorId ?? null,
    })),
  })
}

/**
 * Confirmation d'une contribution en attente : statut, point d'entrée de l'argent
 * et mouvement CONFIRMATION, de façon conditionnelle (une seule confirmation).
 * Renvoie false si la contribution n'était plus en attente.
 */
export async function confirmIntoLedger(
  tx: Tx,
  contribution: { id: string; montant: number; modePaiement: ModePaiement; collecteurId: string | null },
  data: { confirmedById?: string | null; confirmedAt?: Date; extra?: Prisma.ContributionUpdateManyMutationInput },
): Promise<boolean> {
  const entry = entryPoint(contribution)
  const result = await tx.contribution.updateMany({
    where: { id: contribution.id, statut: 'EN_ATTENTE_CONFIRMATION' },
    data: {
      ...data.extra,
      statut: 'CONFIRME',
      paymentStatus: 'SUCCESS',
      confirmedAt: data.confirmedAt ?? new Date(),
      ...(data.confirmedById !== undefined && { confirmedById: data.confirmedById }),
      localisationFonds: entry.location,
      detenteurId: entry.holderId,
    },
  })
  if (result.count !== 1) return false
  await recordMovements(tx, [{
    contributionId: contribution.id,
    montant: contribution.montant,
    from: null,
    to: entry.location,
    holderToId: entry.holderId,
    reason: 'CONFIRMATION',
    actorId: data.confirmedById ?? null,
  }])
  return true
}

/** Mouvement d'entrée pour une contribution créée directement confirmée (espèces en main). */
export async function recordDirectEntry(
  tx: Tx,
  contribution: { id: string; montant: number; modePaiement: ModePaiement; collecteurId: string | null },
  actorId: string,
): Promise<void> {
  const entry = entryPoint(contribution)
  await tx.contribution.update({ where: { id: contribution.id }, data: { localisationFonds: entry.location, detenteurId: entry.holderId } })
  await recordMovements(tx, [{
    contributionId: contribution.id, montant: contribution.montant, from: null, to: entry.location,
    holderToId: entry.holderId, reason: 'CONFIRMATION', actorId,
  }])
}

/**
 * Litige résolu « annulée » sur une contribution dont l'argent était entré dans le
 * grand livre : sortie du circuit depuis son emplacement actuel. Sans mouvement
 * antérieur (litige ouvert avant toute confirmation), rien n'est écrit.
 */
export async function recordDisputeExit(
  tx: Tx,
  contribution: { id: string; montant: number; localisationFonds: LocalisationFonds; detenteurId: string | null },
  actorId: string,
): Promise<boolean> {
  const entered = await tx.fundMovement.findFirst({ where: { contributionId: contribution.id }, select: { id: true } })
  if (!entered) return false
  await recordMovements(tx, [{
    contributionId: contribution.id, montant: contribution.montant, from: contribution.localisationFonds, to: 'HORS_CIRCUIT',
    holderFromId: contribution.detenteurId, reason: 'ANNULATION_LITIGE', actorId,
  }])
  await tx.contribution.update({ where: { id: contribution.id }, data: { localisationFonds: 'HORS_CIRCUIT', detenteurId: null } })
  return true
}

// ── Contrôles et positions (jalon J3) ──────────────────────────────────

type LastMovement = { contributionId: string; toLocation: LocalisationFonds; holderToId: string | null }

export interface LedgerCheck {
  checkedAt: string
  confirmedCount: number
  mismatches: Array<{ contributionId: string; localisationFonds: LocalisationFonds; detenteurId: string | null; ledgerLocation: LocalisationFonds | null; ledgerHolderId: string | null }>
}

/**
 * Invariant : pour chaque contribution confirmée, le dernier mouvement du grand
 * livre donne exactement son emplacement et son détenteur actuels.
 */
export async function checkLedger(db: PrismaClient): Promise<LedgerCheck> {
  const [confirmed, cancelled, last] = await Promise.all([
    db.contribution.findMany({ where: { statut: 'CONFIRME' }, select: { id: true, localisationFonds: true, detenteurId: true } }),
    // Annulée après être entrée dans le grand livre : son dernier mouvement doit être la sortie du circuit
    db.contribution.findMany({ where: { statut: 'ANNULE', fundMovements: { some: {} } }, select: { id: true, localisationFonds: true, detenteurId: true } }),
    db.$queryRaw<LastMovement[]>`
      SELECT DISTINCT ON ("contributionId") "contributionId", "toLocation", "holderToId"
      FROM "fund_movements" ORDER BY "contributionId", "at" DESC, "id" DESC`,
  ])
  const lastById = new Map(last.map(m => [m.contributionId, m]))
  const mismatches = confirmed
    .map(c => ({ c, m: lastById.get(c.id) }))
    .filter(({ c, m }) => !m || m.toLocation !== c.localisationFonds || (m.holderToId ?? null) !== (c.detenteurId ?? null))
    .concat(cancelled.map(c => ({ c, m: lastById.get(c.id) })).filter(({ m }) => m?.toLocation !== 'HORS_CIRCUIT'))
    .map(({ c, m }) => ({
      contributionId: c.id, localisationFonds: c.localisationFonds, detenteurId: c.detenteurId,
      ledgerLocation: m?.toLocation ?? null, ledgerHolderId: m?.holderToId ?? null,
    }))
  return { checkedAt: new Date().toISOString(), confirmedCount: confirmed.length, mismatches }
}

export interface FundsPosition {
  at: string
  ledgerStartedAt: string | null
  beforeLedgerStart: boolean
  byLocation: Array<{ location: LocalisationFonds; amount: number; count: number }>
  total: number
}

/** Position des fonds à une date : dernier mouvement de chaque contribution à cette date. */
export async function positionAt(db: PrismaClient, at: Date): Promise<FundsPosition> {
  const [rows, start] = await Promise.all([
    db.$queryRaw<Array<{ location: LocalisationFonds; amount: bigint; count: bigint }>>`
      SELECT m."toLocation" AS location, SUM(m."montant") AS amount, COUNT(*) AS count
      FROM (
        SELECT DISTINCT ON ("contributionId") "toLocation", "montant"
        FROM "fund_movements" WHERE "at" <= ${at}
        ORDER BY "contributionId", "at" DESC, "id" DESC
      ) m
      WHERE m."toLocation" <> 'HORS_CIRCUIT'
      GROUP BY m."toLocation" ORDER BY m."toLocation"`,
    db.fundMovement.findFirst({ orderBy: { at: 'asc' }, select: { at: true } }),
  ])
  // Remboursements exécutés à cette date : argent sorti de l'emplacement d'où il a été rendu
  const refunded = await refundsByLocation(db, at)
  const byLocation = rows.map(r => ({ location: r.location, amount: Number(r.amount) - (refunded.get(r.location) ?? 0), count: Number(r.count) }))
  for (const [location, amount] of refunded) {
    if (!byLocation.some(r => r.location === location)) byLocation.push({ location: location as LocalisationFonds, amount: -amount, count: 0 })
  }
  return {
    at: at.toISOString(),
    ledgerStartedAt: start?.at.toISOString() ?? null,
    beforeLedgerStart: !start || at < start.at,
    byLocation,
    total: byLocation.reduce((sum, r) => sum + r.amount, 0),
  }
}
