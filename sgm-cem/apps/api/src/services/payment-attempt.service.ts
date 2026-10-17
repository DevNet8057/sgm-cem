import { getPrisma } from '../lib/prisma'
import { initiateYeliiPayment, normalizeCameroonMobilePhone, type YeliiPaymentResult } from './yelii.service'
import { alertTresoriers } from './notification'

const prisma = getPrisma()

// Fenêtre de rattachement d'un webhook orphelin à une initiation incertaine
const ORPHAN_LINK_WINDOW_MS = 2 * 60 * 60 * 1000

/** Réponse perdue : le payeur a peut-être reçu la demande USSD et payé. */
export function isUncertainYeliiResult(result: YeliiPaymentResult): boolean {
  return result.code === 'YELII_UNAVAILABLE' || result.code === 'YELII_INVALID_RESPONSE'
}

/**
 * Initiation Yelii journalisée : chaque demande laisse une trace (montant,
 * numéro, lignes concernées) qui permet de retrouver plus tard un paiement
 * dont la réponse s'est perdue.
 */
export async function initiateTrackedYeliiPayment(params: {
  amount: number
  senderPhone: string
  channel: 'mtn_money' | 'orange_money'
  contributionIds: string[]
  paymentBatchId?: string
  source: 'payments_initiate' | 'payment_batch' | 'public_collecte'
}): Promise<YeliiPaymentResult> {
  const attempt = await prisma.paymentAttempt.create({
    data: {
      provider: 'YELII',
      amount: params.amount,
      phone: normalizeCameroonMobilePhone(params.senderPhone) ?? null,
      channel: params.channel,
      contributionIds: params.contributionIds,
      paymentBatchId: params.paymentBatchId ?? null,
      source: params.source,
    },
  })

  const result = await initiateYeliiPayment({ amount: params.amount, senderPhone: params.senderPhone, channel: params.channel })

  // Le journal ne doit jamais faire échouer un paiement déjà envoyé au prestataire
  try {
    if (result.success && result.transactionId) {
      await prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { status: 'PROCESSING', providerTransactionId: result.transactionId },
      })
    } else {
      const uncertain = isUncertainYeliiResult(result)
      await prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { status: uncertain ? 'UNCERTAIN' : 'FAILED', errorCode: result.code ?? null, resolvedAt: uncertain ? null : new Date() },
      })
    }
  } catch (e) {
    console.error(`[PaymentAttempt] Journalisation de la tentative ${attempt.id} impossible`, e)
  }
  return result
}

/**
 * Webhook Yelii portant un identifiant inconnu : rattachement à UNE initiation
 * incertaine de même montant et même numéro, récente. Jamais de rattachement
 * en cas d'ambiguïté — les trésoriers sont alors alertés pour un contrôle manuel.
 */
export async function linkOrphanYeliiTransaction(transactionId: string, received: { amount?: number; senderPhone?: string }): Promise<boolean> {
  const phone = received.senderPhone ? normalizeCameroonMobilePhone(received.senderPhone) : undefined
  if (received.amount == null || !phone) {
    await alertOrphan(transactionId, received, 'montant ou numéro absent du webhook')
    return false
  }

  const candidates = await prisma.paymentAttempt.findMany({
    where: {
      provider: 'YELII',
      status: { in: ['UNCERTAIN', 'INITIATING'] },
      amount: received.amount,
      phone,
      providerTransactionId: null,
      createdAt: { gte: new Date(Date.now() - ORPHAN_LINK_WINDOW_MS) },
    },
    take: 2,
  })
  if (candidates.length !== 1) {
    await alertOrphan(transactionId, received, candidates.length === 0 ? 'aucune tentative correspondante' : 'plusieurs tentatives possibles')
    return false
  }

  const [attempt] = candidates
  const linked = await prisma.$transaction(async tx => {
    const claimed = await tx.paymentAttempt.updateMany({
      where: { id: attempt.id, providerTransactionId: null },
      data: { status: 'LINKED', providerTransactionId: transactionId, resolvedAt: new Date() },
    })
    if (claimed.count !== 1) return false
    await tx.contribution.updateMany({
      where: { id: { in: attempt.contributionIds }, externalTransactionId: null, statut: 'EN_ATTENTE_CONFIRMATION' },
      data: { externalTransactionId: transactionId, paymentStatus: 'PROCESSING' },
    })
    if (attempt.paymentBatchId) {
      await tx.paymentBatch.updateMany({ where: { id: attempt.paymentBatchId, externalTransactionId: null }, data: { externalTransactionId: transactionId } })
    }
    return true
  })
  if (linked) console.info(`[Yelii] Transaction ${transactionId} rattachée à la tentative ${attempt.id}`)
  return linked
}

async function alertOrphan(transactionId: string, received: { amount?: number }, reason: string): Promise<void> {
  console.warn(`[Yelii] Paiement reçu non rattaché (${transactionId}) : ${reason}`)
  await alertTresoriers(
    'Paiement Mobile Money reçu sans contribution',
    `Transaction ${transactionId}${received.amount != null ? ` de ${received.amount.toLocaleString('fr-FR')} FCFA` : ''} : ${reason}. Vérifiez dans la console Yelii et rattachez-la manuellement.`,
    { transactionId, amount: received.amount ?? null, reason },
  )
}

/** Initiations restées incertaines : signalées une fois, pour contrôle dans la console Yelii. */
export async function reportStaleUncertainAttempts(): Promise<number> {
  const stale = await prisma.paymentAttempt.findMany({
    where: { status: 'UNCERTAIN', createdAt: { lte: new Date(Date.now() - ORPHAN_LINK_WINDOW_MS) }, resolvedAt: null },
    take: 50,
  })
  if (stale.length === 0) return 0
  await alertTresoriers(
    'Paiements Mobile Money à vérifier',
    `${stale.length} demande(s) de paiement sans réponse de Yelii depuis plus de 2 h : vérifiez dans la console Yelii si le payeur a été débité.`,
    { attemptIds: stale.map(a => a.id), contributionIds: stale.flatMap(a => a.contributionIds) },
  )
  await prisma.paymentAttempt.updateMany({ where: { id: { in: stale.map(a => a.id) } }, data: { resolvedAt: new Date() } })
  return stale.length
}
