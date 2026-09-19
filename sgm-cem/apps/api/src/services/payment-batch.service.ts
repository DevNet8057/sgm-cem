import { createHash } from 'crypto'
import { Prisma, type ModePaiement, type PrismaClient } from '@prisma/client'
import {
  calculateAmountWithCommission,
  resolveDueAmount,
  YELII_COMMISSION_RATE,
} from '@sgm-cem/shared'
import { getPrisma } from '../lib/prisma'
import { getConfigBool, getConfigNumber } from './config.service'

const MAX_LINES = 50
const POSTGRES_INT_MAX = 2_147_483_647
const DEFAULT_COMMISSION_RATE = YELII_COMMISSION_RATE

export type BatchPaymentMode = 'YELII' | 'CARTE_VISA' | 'ESPECES'
export type PaymentChannel = 'MTN' | 'ORANGE'

export interface PaymentBatchAllocationInput {
  rubriqueId: string
  montant: number
}

export interface CreatePaymentBatchInput {
  idempotencyKey: string
  membreId: string
  budgetAmount: number
  allocations: readonly PaymentBatchAllocationInput[]
  modePaiement: BatchPaymentMode
  mobileMoneyPhone?: string
  paymentChannel?: PaymentChannel
  customerPhone?: string
  collecteurId?: string
}

export interface NormalizedPaymentBatch {
  idempotencyKey: string
  membreId: string
  budget: number
  allocations: PaymentBatchAllocationInput[]
  totalAllocated: number
  remainingAmount: number
  modePaiement: ModePaiement
  commissionRate: number
  commissionAmount: number
  totalToPay: number
  mobileMoneyPhone: string | null
  collecteurId: string | null
}

export interface PaymentBatchResult extends NormalizedPaymentBatch {
  batchId: string
  status: 'PENDING' | 'CONFIRMED' | 'FAILED'
  paymentUrl: string | null
  externalTransactionId: string | null
  contributions: Array<{
    id: string
    rubriqueId: string
    montant: number
    commissionAmount: number
    amountChargedToPayer: number
    statut: string
    paymentStatus: string | null
  }>
  created: boolean
}

export class PaymentBatchError extends Error {
  readonly statusCode: number
  readonly code: string

  constructor(code: string, message: string, statusCode = 400) {
    super(message)
    this.name = 'PaymentBatchError'
    this.code = code
    this.statusCode = statusCode
  }
}

function fail(code: string, message: string, statusCode = 400): never {
  throw new PaymentBatchError(code, message, statusCode)
}

function assertPositiveInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > POSTGRES_INT_MAX) {
    fail('VALIDATION', `${name} doit être un entier positif inférieur ou égal à ${POSTGRES_INT_MAX}`)
  }
}

function normalizeMode(input: BatchPaymentMode, channel?: PaymentChannel): ModePaiement {
  if (input === 'YELII') return channel === 'ORANGE' ? 'ORANGE_MONEY' : 'MTN_MOMO'
  return input
}

function canonicalFingerprint(input: CreatePaymentBatchInput, normalized: NormalizedPaymentBatch): string {
  const payload = {
    membreId: normalized.membreId,
    budget: normalized.budget,
    allocations: normalized.allocations,
    modePaiement: normalized.modePaiement,
    mobileMoneyPhone: normalized.mobileMoneyPhone,
    channel: input.paymentChannel ?? null,
    customerPhone: input.customerPhone?.trim() || null,
    collecteurId: normalized.collecteurId,
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function getCommissionRate(mode: BatchPaymentMode): number {
  if (mode !== 'YELII') return 0
  const rate = getConfigNumber('YELII_COMMISSION_RATE', DEFAULT_COMMISSION_RATE)
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) {
    fail('CONFIGURATION', 'Le taux de commission Mobile Money est invalide', 500)
  }
  return rate
}

/** Répartition entière stable : les plus grands restes reçoivent les unités restantes. */
function distributeCommission(amount: number, allocations: readonly PaymentBatchAllocationInput[]): number[] {
  if (amount === 0) return allocations.map(() => 0)
  const total = allocations.reduce((sum, line) => sum + line.montant, 0)
  const shares = allocations.map((line, index) => ({
    index,
    value: Math.floor((amount * line.montant) / total),
    remainder: (amount * line.montant) % total,
  }))
  let remaining = amount - shares.reduce((sum, share) => sum + share.value, 0)
  shares.sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (const share of shares) {
    if (remaining <= 0) break
    share.value += 1
    remaining -= 1
  }
  return shares.sort((a, b) => a.index - b.index).map(share => share.value)
}

/** Valide et calcule la demande sans effectuer aucune lecture ni écriture. */
export function validatePaymentBatchInput(input: CreatePaymentBatchInput): NormalizedPaymentBatch {
  if (!input || typeof input !== 'object') fail('VALIDATION', 'La demande de paiement est requise')
  if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.trim().length < 8 || input.idempotencyKey.length > 255) {
    fail('VALIDATION', 'La clé d’idempotence est requise et doit contenir entre 8 et 255 caractères')
  }
  if (typeof input.membreId !== 'string' || !input.membreId.trim()) fail('VALIDATION', 'Le membre est requis')
  assertPositiveInt(input.budgetAmount, 'Le budget')
  if (!Array.isArray(input.allocations) || input.allocations.length < 1 || input.allocations.length > MAX_LINES) {
    fail('VALIDATION', `Le paiement doit contenir entre 1 et ${MAX_LINES} allocations`)
  }

  const ids = new Set<string>()
  const allocations = input.allocations.map((line, index) => {
    if (!line || typeof line.rubriqueId !== 'string' || !line.rubriqueId.trim()) {
      fail('VALIDATION', `La rubrique de la ligne ${index + 1} est requise`)
    }
    const rubriqueId = line.rubriqueId.trim()
    if (ids.has(rubriqueId)) fail('VALIDATION', `La rubrique ${rubriqueId} est répétée`)
    ids.add(rubriqueId)
    assertPositiveInt(line.montant, `Le montant de la ligne ${index + 1}`)
    return { rubriqueId, montant: line.montant }
  })

  const totalAllocated = allocations.reduce((sum, line) => sum + line.montant, 0)
  if (!Number.isSafeInteger(totalAllocated) || totalAllocated > POSTGRES_INT_MAX) {
    fail('VALIDATION', 'La somme des allocations dépasse la limite autorisée')
  }
  if (totalAllocated > input.budgetAmount) fail('BUDGET_EXCEEDED', 'La somme répartie dépasse le budget')

  if (input.modePaiement === 'YELII') {
    if (!getConfigBool('MOBILE_MONEY_ENABLED', true)) fail('MOBILE_MONEY_DISABLED', 'Le paiement Mobile Money est désactivé', 403)
    if (!input.mobileMoneyPhone?.trim() || !input.paymentChannel) {
      fail('VALIDATION', 'Le numéro et le réseau sont requis pour Mobile Money')
    }
  }
  if (input.modePaiement === 'CARTE_VISA' && !getConfigBool('CARD_ENABLED', true)) {
    fail('CARD_DISABLED', 'Le paiement par carte est désactivé', 403)
  }
  if (input.modePaiement === 'ESPECES') {
    if (!getConfigBool('CASH_ENABLED', true)) fail('CASH_DISABLED', 'Le paiement en espèces est désactivé', 403)
    if (!input.collecteurId?.trim()) fail('VALIDATION', 'Un collecteur est requis pour un paiement en espèces')
  }

  const commissionRate = getCommissionRate(input.modePaiement)
  const charged = calculateAmountWithCommission(totalAllocated, commissionRate)
  if (input.modePaiement === 'CARTE_VISA' && charged.totalToPay % 5 !== 0) {
    fail('VALIDATION', 'Le montant total payé par carte doit être un multiple de 5 FCFA')
  }
  return {
    idempotencyKey: input.idempotencyKey.trim(),
    membreId: input.membreId.trim(),
    budget: input.budgetAmount,
    allocations,
    totalAllocated,
    remainingAmount: input.budgetAmount - totalAllocated,
    modePaiement: normalizeMode(input.modePaiement, input.paymentChannel),
    commissionRate,
    commissionAmount: charged.commissionAmount,
    totalToPay: charged.totalToPay,
    mobileMoneyPhone: input.mobileMoneyPhone?.trim() || null,
    collecteurId: input.collecteurId?.trim() || null,
  }
}

function serializeBatch(batch: any, normalized: NormalizedPaymentBatch, created: boolean): PaymentBatchResult {
  const rows = Array.isArray(batch.contributions) ? batch.contributions : []
  return {
    ...normalized,
    batchId: batch.id,
    status: batch.status,
    paymentUrl: batch.paymentUrl ?? null,
    externalTransactionId: batch.externalTransactionId ?? null,
    contributions: rows.map((row: any) => ({
      id: row.id,
      rubriqueId: row.rubriqueId,
      montant: row.montant,
      commissionAmount: row.commissionPaidByPayer ?? 0,
      amountChargedToPayer: row.amountChargedToPayer ?? row.montant,
      statut: row.statut,
      paymentStatus: row.paymentStatus ?? null,
    })),
    created,
  }
}

const batchInclude = { contributions: { orderBy: { createdAt: 'asc' as const } } } as const

async function findExisting(prisma: PrismaClient, key: string, fingerprint: string) {
  return (prisma as any).paymentBatch.findFirst({
    where: { OR: [{ idempotencyKey: key }, { requestFingerprint: fingerprint }] },
    include: batchInclude,
  })
}

/**
 * Réserve un paiement multi-rubrique en une seule transaction.
 * Aucun fournisseur n'est appelé ici : le lot reste PENDING afin que la route
 * puisse déclencher explicitement son adaptateur ou simuler ce comportement.
 */
export async function createPaymentBatch(
  input: CreatePaymentBatchInput,
  client: PrismaClient = getPrisma(),
): Promise<PaymentBatchResult> {
  const normalized = validatePaymentBatchInput(input)
  const fingerprint = canonicalFingerprint(input, normalized)

  const existingBefore = await findExisting(client, normalized.idempotencyKey, fingerprint)
  if (existingBefore) {
    if (existingBefore.requestFingerprint !== fingerprint) {
      fail('IDEMPOTENCY_CONFLICT', 'La clé d’idempotence est déjà utilisée avec une autre demande', 409)
    }
    return serializeBatch(existingBefore, normalized, false)
  }

  try {
    const transactionResult = await client.$transaction(async (tx: any) => {
      // La fonction de verrou PostgreSQL renvoie void : executeRaw évite une
      // désérialisation impossible par Prisma tout en gardant le verrou de transaction.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${normalized.idempotencyKey}, 0))`)

      const existing = await tx.paymentBatch.findFirst({
        where: { OR: [{ idempotencyKey: normalized.idempotencyKey }, { requestFingerprint: fingerprint }] },
        include: batchInclude,
      })
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) {
          fail('IDEMPOTENCY_CONFLICT', 'La clé d’idempotence est déjà utilisée avec une autre demande', 409)
        }
        return { batch: existing, created: false }
      }

      const [membre, rubriques] = await Promise.all([
        tx.membre.findUnique({
          where: { id: normalized.membreId },
          select: { id: true, isActive: true, profilFinancier: true },
        }),
        tx.rubrique.findMany({
          where: { id: { in: normalized.allocations.map(line => line.rubriqueId) } },
          select: { id: true, status: true, amountTravailleur: true, amountEtudiant: true, amountCouple: true },
        }),
      ])
      if (!membre || !membre.isActive) fail('MEMBER_NOT_FOUND', 'Membre introuvable ou inactif', 404)
      if (rubriques.length !== normalized.allocations.length || rubriques.some((r: any) => r.status !== 'OUVERTE')) {
        fail('RUBRIQUE_CLOSED', 'Une ou plusieurs rubriques sont fermées ou introuvables')
      }

      if (normalized.collecteurId) {
        const collecteur = await tx.user.findUnique({ where: { id: normalized.collecteurId }, select: { id: true, role: true, isActive: true } })
        if (!collecteur || !collecteur.isActive || !['COLLECTEUR', 'RESPONSABLE', 'ADJOINT_RESPONSABLE', 'TRESORIER', 'ADMIN', 'DEVELOPER'].includes(collecteur.role)) {
          fail('COLLECTOR_INVALID', 'Le collecteur est introuvable, inactif ou non éligible')
        }
      }

      const commissionLines = distributeCommission(normalized.commissionAmount, normalized.allocations)
      const rubricById = new Map(rubriques.map((r: any) => [r.id, r]))
      const mode = normalized.modePaiement
      const batch = await tx.paymentBatch.create({
        data: {
          membreId: normalized.membreId,
          budget: normalized.budget,
          allocations: normalized.allocations as unknown as Prisma.InputJsonValue,
          totalAllocated: normalized.totalAllocated,
          status: 'PENDING',
          idempotencyKey: normalized.idempotencyKey,
          requestFingerprint: fingerprint,
          contributions: {
            create: normalized.allocations.map((line, index) => {
              const rubrique = rubricById.get(line.rubriqueId)!
              const commissionAmount = commissionLines[index]
              return {
                membreId: normalized.membreId,
                rubriqueId: line.rubriqueId,
                collecteurId: normalized.collecteurId,
                montant: line.montant,
                montantAttendu: resolveDueAmount(membre.profilFinancier, rubrique),
                modePaiement: mode,
                statut: 'EN_ATTENTE_CONFIRMATION',
                paymentStatus: 'PENDING',
                localisationFonds: mode === 'ESPECES' ? 'CHEZ_COLLECTEUR' : 'EN_TRANSIT',
                mobileMoneyPhone: normalized.mobileMoneyPhone,
                amountChargedToPayer: line.montant + commissionAmount,
                commissionPaidByPayer: commissionAmount,
              }
            }),
          },
        },
        include: batchInclude,
      })
      return { batch, created: true }
    })
    return serializeBatch(transactionResult.batch, normalized, transactionResult.created)
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const existing = await findExisting(client, normalized.idempotencyKey, fingerprint)
      if (existing && existing.requestFingerprint === fingerprint) return serializeBatch(existing, normalized, false)
    }
    throw error
  }
}

/** Récupère un lot par son identifiant, sa clé d’idempotence ou sa transaction. */
export async function getPaymentBatch(identifier: string, client: PrismaClient = getPrisma()): Promise<PaymentBatchResult | null> {
  const batch = await (client as any).paymentBatch.findFirst({
    where: { OR: [{ id: identifier }, { idempotencyKey: identifier }, { externalTransactionId: identifier }] },
    include: batchInclude,
  })
  if (!batch) return null
  const allocations = Array.isArray(batch.allocations) ? batch.allocations as unknown as PaymentBatchAllocationInput[] : []
  const commissionAmount = batch.contributions.reduce((sum: number, row: any) => sum + (row.commissionPaidByPayer ?? 0), 0)
  return serializeBatch(batch, {
    idempotencyKey: batch.idempotencyKey,
    membreId: batch.membreId ?? '',
    budget: batch.budget,
    allocations,
    totalAllocated: batch.totalAllocated,
    remainingAmount: batch.budget - batch.totalAllocated,
    modePaiement: batch.contributions[0]?.modePaiement ?? 'YELII',
    commissionRate: batch.totalAllocated ? commissionAmount / batch.totalAllocated : 0,
    commissionAmount,
    totalToPay: batch.totalAllocated + commissionAmount,
    mobileMoneyPhone: batch.contributions[0]?.mobileMoneyPhone ?? null,
    collecteurId: batch.contributions[0]?.collecteurId ?? null,
  }, false)
}
