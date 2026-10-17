import type { Prisma } from '@prisma/client'
import { getPrisma } from '../lib/prisma'
import { recordMovements } from './fund-ledger.service'
import { getYeliiTransaction } from './yelii.service'
import { verifyCinetpayTransaction } from './cinetpay.service'
import { generateReceiptPDF } from './receipt'
import { broadcastToAll } from '../lib/socket'
import { sendWhatsApp, sendWhatsAppDocument, alertTresoriers, notifyMemberConfirmed } from './notification'
import { audit } from './audit.service'

/**
 * Synchronisation du statut d'une contribution digitale avec son fournisseur —
 * repli des webhooks qui peuvent être en retard ou perdus. Consommé par les
 * routes de polling `GET .../payment-status`.
 *
 * Arbitrages assumés, iso des webhooks Yelii et CinetPay :
 * - `audit()` en best-effort (`void`, ne bloque jamais la réponse) sur les transitions
 *   CONFIRME/ANNULE, rattaché au vrai compte membre ou au compte système public.
 * - notification WhatsApp : ce service gagne quasi systématiquement la course
 *   contre le webhook (confirmation en ~5 s), qui sort alors sur sa garde
 *   d'idempotence sans rien notifier. Le gagnant du `updateMany` (`count === 1`)
 *   est donc l'unique émetteur légitime — c'est lui qui notifie ici, pas le webhook.
 * - pas de `getConfig()` ici : chaque fournisseur encapsule sa propre configuration.
 * - pas de cache TTL : la garde « statut terminal » suffit, le client cesse de
 *   poller dès que la contribution passe CONFIRME/ANNULE/LITIGE.
 *
 * Limitation connue : le perdant d'une course avec le webhook (ou un autre appel
 * concurrent) peut recevoir statut: 'CONFIRME' avec receiptUrl: null si le PDF est
 * encore en génération côté gagnant — les steppers font `if (rUrl) setReceiptUrl(rUrl)`,
 * l'écran reste donc correct, seul le lien de reçu apparaît au chargement suivant.
 */

const prisma = getPrisma()

const TERMINAL_STATUSES = new Set<string>(['CONFIRME', 'ANNULE', 'LITIGE'])
const YELII_MODES = new Set<string>(['MTN_MOMO', 'ORANGE_MONEY', 'YELII'])
const CINETPAY_MODE = 'CARTE_VISA'
const CINETPAY_FAILED_STATUSES = new Set(['REFUSED', 'CANCELLED'])
// Déduplication des appels en vol : un même transactionId n'appelle jamais son
// fournisseur deux fois en parallèle (plusieurs onglets ouverts sur le même paiement).
const inFlight = new Map<string, Promise<PaymentStatusSyncResult>>()
// Garde anti-spam des alertes d'incohérence fournisseur : le polling atteint ce
// code toutes les 5 s. Portée intra-processus volontairement : un redémarrage peut
// au pire réémettre une alerte, ce qui reste préférable à une incohérence ignorée.
const mismatchAlerted = new Set<string>()

export const CONTRIBUTION_SYNC_SELECT = {
  id: true,
  statut: true,
  paymentStatus: true,
  modePaiement: true,
  externalTransactionId: true,
  referencePaiement: true,
  receiptUrl: true,
  rubriqueId: true,
  montant: true,
  amountChargedToPayer: true,
} as const satisfies Prisma.ContributionSelect

export type SyncableContribution = Prisma.ContributionGetPayload<{ select: typeof CONTRIBUTION_SYNC_SELECT }>

export interface PaymentStatusSyncResult {
  id: string
  statut: SyncableContribution['statut']
  paymentStatus: SyncableContribution['paymentStatus'] // nullable au schéma
  receiptUrl: string | null
}

export async function syncPaymentContributionStatus(
  contribution: SyncableContribution
): Promise<PaymentStatusSyncResult> {
  const snapshot: PaymentStatusSyncResult = {
    id: contribution.id,
    statut: contribution.statut,
    paymentStatus: contribution.paymentStatus,
    receiptUrl: contribution.receiptUrl ?? null,
  }

  // Statut déjà définitif — aucun appel réseau.
  if (TERMINAL_STATUSES.has(contribution.statut)) return snapshot

  const txId = contribution.externalTransactionId
  const isYelii = YELII_MODES.has(contribution.modePaiement)
  const isCinetpay = contribution.modePaiement === CINETPAY_MODE
  // ESPECES et VIREMENT n'ont aucun statut fournisseur à synchroniser ici.
  if (!txId || (!isYelii && !isCinetpay)) return snapshot

  const pending = inFlight.get(txId)
  if (pending) return pending

  const task = runSync(contribution, txId, snapshot).finally(() => { inFlight.delete(txId) })
  inFlight.set(txId, task)
  return task
}

/** Alias historique conservé pour les routes et tests existants. */
export async function syncYeliiContributionStatus(
  contribution: SyncableContribution
): Promise<PaymentStatusSyncResult> {
  return syncPaymentContributionStatus(contribution)
}

type PaymentProvider = 'yelii' | 'cinetpay'

interface RemotePaymentState {
  provider: PaymentProvider
  status: 'processing' | 'success' | 'failed' | 'unknown'
  amount?: number
  currency?: string
  netCredited?: number
  remoteCode?: string
  remoteStatus?: string
}

async function getRemotePaymentState(
  contribution: SyncableContribution,
  txId: string
): Promise<RemotePaymentState> {
  if (YELII_MODES.has(contribution.modePaiement)) {
    const remote = await getYeliiTransaction(txId)
    return { provider: 'yelii', ...remote }
  }

  // Source de vérité CinetPay : /payment/check uniquement. Les paramètres du
  // retour navigateur ne sont jamais utilisés pour décider d'une transition.
  return cinetpayRemoteState(await verifyCinetpayTransaction(txId))
}

/** Interprète la réponse de /payment/check (sondage et webhook CinetPay). */
export function cinetpayRemoteState(verification: Awaited<ReturnType<typeof verifyCinetpayTransaction>>): RemotePaymentState {
  const remoteCode = String(verification.code ?? '').trim().toUpperCase()
  const remoteStatus = verification.data?.status?.trim().toUpperCase() ?? ''
  const rawAmount = verification.data?.amount?.trim()
  const parsedAmount = rawAmount ? Number(rawAmount) : undefined
  const amount = parsedAmount != null && Number.isFinite(parsedAmount) ? parsedAmount : undefined
  const currency = verification.data?.currency?.trim().toUpperCase() ?? ''

  if (remoteStatus === 'ACCEPTED' && remoteCode === '00') {
    return { provider: 'cinetpay', status: 'success', amount, currency, remoteCode, remoteStatus }
  }
  if (CINETPAY_FAILED_STATUSES.has(remoteStatus)) {
    return { provider: 'cinetpay', status: 'failed', amount, currency, remoteCode, remoteStatus }
  }
  return { provider: 'cinetpay', status: 'processing', amount, currency, remoteCode, remoteStatus }
}

async function runSync(
  contribution: SyncableContribution,
  txId: string,
  snapshot: PaymentStatusSyncResult
): Promise<PaymentStatusSyncResult> {
  try {
    const remote = await getRemotePaymentState(contribution, txId)
    if (remote.status === 'processing' || remote.status === 'unknown') return snapshot
    await applyProviderOutcome(txId, { ...remote, status: remote.status, source: 'payment_status_poll' })
    const current = await prisma.contribution.findUnique({
      where: { id: contribution.id },
      select: { id: true, statut: true, paymentStatus: true, receiptUrl: true },
    })
    return current ? { id: current.id, statut: current.statut, paymentStatus: current.paymentStatus, receiptUrl: current.receiptUrl ?? null } : snapshot
  } catch (e) {
    // Cette route est appelée toutes les 5 secondes en polling — une erreur fournisseur,
    // Prisma ou Puppeteer ne doit jamais produire un 500 côté client.
    console.error('[PaymentStatus]', e)
    return snapshot
  }
}

export interface ProviderOutcome {
  provider: PaymentProvider
  status: 'success' | 'failed'
  amount?: number
  currency?: string
  netCredited?: number
  remoteCode?: string
  remoteStatus?: string
  source: 'payment_status_poll' | 'webhook' | 'reconciliation'
}

export type ProviderOutcomeResult = 'confirmed' | 'failed' | 'mismatch' | 'already_processed' | 'unknown_transaction'

/**
 * Applique la réponse d'un prestataire à TOUTE la transaction : un paiement
 * réparti (PaymentBatch) partage un seul identifiant fournisseur entre
 * plusieurs lignes. Le montant reçu est comparé au total de la transaction, et
 * toutes les lignes changent d'état ensemble (preuve P1 de l'audit : avant,
 * chaque ligne était comparée au total et aucune n'était jamais confirmée).
 *
 * Point d'entrée unique du sondage, des webhooks Yelii et CinetPay et de la
 * réconciliation. Écritures conditionnelles : un seul appelant « gagne » et
 * émet reçus, notifications et audit.
 */
export async function applyProviderOutcome(txId: string, outcome: ProviderOutcome): Promise<ProviderOutcomeResult> {
  const lines = await prisma.contribution.findMany({
    where: { externalTransactionId: txId },
    select: { id: true, statut: true, montant: true, amountChargedToPayer: true, paymentBatchId: true, rubriqueId: true, referencePaiement: true },
    orderBy: { createdAt: 'asc' },
  })
  if (lines.length === 0) return 'unknown_transaction'
  const pending = lines.filter(line => line.statut === 'EN_ATTENTE_CONFIRMATION')
  if (pending.length === 0) return 'already_processed'

  if (outcome.status === 'success') {
    // Yelii renvoie le montant majoré (commission à la charge du payeur) ;
    // CinetPay doit renvoyer exactement le montant dû, obligatoirement en XAF.
    const expectedAmount = lines.reduce((sum, line) => sum + (
      outcome.provider === 'yelii' ? line.amountChargedToPayer ?? line.montant : line.montant
    ), 0)
    const amountMatches = outcome.provider === 'yelii'
      ? outcome.amount == null || outcome.amount === expectedAmount
      : outcome.amount === expectedAmount
    const currencyMatches = outcome.provider === 'yelii' || outcome.currency === 'XAF'

    if (!amountMatches || !currencyMatches) {
      const receivedAmountLabel = outcome.amount != null ? outcome.amount.toLocaleString('fr-FR') : 'absent'
      const receivedCurrency = outcome.currency || (outcome.provider === 'yelii' ? 'FCFA' : 'devise absente')
      console.warn(`[PaymentStatus] Données incohérentes pour ${txId} : ${expectedAmount} XAF attendus, ${receivedAmountLabel} ${receivedCurrency} reçus`)
      if (!mismatchAlerted.has(txId)) {
        mismatchAlerted.add(txId)
        await alertTresoriers(
          outcome.provider === 'yelii' ? 'Montant incohérent — paiement Mobile Money' : 'Paiement CinetPay incohérent',
          `${expectedAmount.toLocaleString('fr-FR')} XAF attendus, ${receivedAmountLabel} ${receivedCurrency} reçus (transaction ${txId})`,
          {
            contributionId: lines[0].id,
            contributionIds: lines.map(line => line.id),
            transactionId: txId,
            expectedAmount,
            expectedCurrency: 'XAF',
            receivedAmount: outcome.amount ?? null,
            receivedCurrency,
            source: outcome.source,
            provider: outcome.provider,
          },
          { view: 'contributions', id: lines[0].id }
        )
      }
      return 'mismatch'
    }

    // Net crédité connu pour la transaction entière : rangé seulement s'il n'y a qu'une ligne
    const netAmount = outcome.provider === 'yelii' && lines.length === 1 ? outcome.netCredited ?? null : null
    const confirmedAt = new Date()
    const { count } = await prisma.$transaction(async tx => {
      const result = await tx.contribution.updateMany({
        where: { externalTransactionId: txId, statut: 'EN_ATTENTE_CONFIRMATION' },
        data: {
          statut: 'CONFIRME',
          confirmedAt,
          paymentStatus: 'SUCCESS',
          netAmount,
          // Compte marchand Yelii/CinetPay : aucune personne ne détient cet argent
          localisationFonds: 'PORTEFEUILLE_ELECTRONIQUE',
          detenteurId: null,
        },
      })
      if (result.count === 0) return result
      // Confirmation partielle (course avec un autre appelant) : tout annuler, la
      // réconciliation reprendra la transaction entière
      if (result.count !== pending.length) throw new Error(`Confirmation partielle de ${txId} : ${result.count}/${pending.length}`)
      await recordMovements(tx, pending.map(line => ({
        contributionId: line.id, montant: line.montant, from: null, to: 'PORTEFEUILLE_ELECTRONIQUE' as const,
        reason: 'CONFIRMATION' as const, transferId: null,
      })))
      // Référence de paiement par défaut = identifiant fournisseur
      await tx.contribution.updateMany({
        where: { externalTransactionId: txId, referencePaiement: null },
        data: { referencePaiement: txId },
      })
      await tx.paymentBatch.updateMany({ where: { externalTransactionId: txId, status: 'PENDING' }, data: { status: 'CONFIRMED' } })
      return result
    })
    if (count === 0) return 'already_processed'

    // Gagnant de la course — seul appelant à générer les reçus et à notifier
    for (const line of pending) {
      const receiptUrl = await generateReceiptPDF(line.id)
      broadcastToAll('contribution:confirmed', { contributionId: line.id, rubriqueId: line.rubriqueId })
      void notifyContributeur(line.id, 'success', receiptUrl ?? null, 'CONFIRM', {
        transactionId: txId,
        source: outcome.source,
        provider: outcome.provider,
        netAmount,
        lines: lines.length,
        ...(outcome.remoteCode && { remoteCode: outcome.remoteCode }),
        ...(outcome.remoteStatus && { remoteStatus: outcome.remoteStatus }),
      }, { notify: line.id === pending[0].id, batchTotal: lines.length > 1 ? lines.reduce((s, l) => s + l.montant, 0) : undefined })
        .catch((e: unknown) => console.error('[PaymentStatus] Notification ou audit échoué', e))
    }
    return 'confirmed'
  }

  const { count } = await prisma.$transaction(async tx => {
    const result = await tx.contribution.updateMany({
      where: { externalTransactionId: txId, statut: 'EN_ATTENTE_CONFIRMATION' },
      data: {
        statut: 'ANNULE',
        paymentStatus: 'FAILED',
        litigeMotif: outcome.provider === 'yelii' ? 'Paiement Yelii échoué ou annulé.' : 'Paiement CinetPay refusé ou annulé.',
      },
    })
    await tx.paymentBatch.updateMany({ where: { externalTransactionId: txId, status: 'PENDING' }, data: { status: 'FAILED' } })
    return result
  })
  if (count === 0) return 'already_processed'
  for (const line of pending) {
    void notifyContributeur(line.id, 'failed', null, 'REJECT', {
      transactionId: txId,
      source: outcome.source,
      provider: outcome.provider,
      ...(outcome.remoteCode && { remoteCode: outcome.remoteCode }),
      ...(outcome.remoteStatus && { remoteStatus: outcome.remoteStatus }),
    }, { notify: line.id === pending[0].id }).catch((e: unknown) => console.error('[PaymentStatus] Notification ou audit échoué', e))
  }
  return 'failed'
}

// AuditLog.userId référence User : les contributions publiques utilisent le
// même compte système désactivé que routes/public.ts, jamais un identifiant libre.
let publicAuditUserId: string | null = null
async function getPublicAuditUserId(): Promise<string> {
  if (publicAuditUserId) return publicAuditUserId
  const user = await prisma.user.upsert({
    where: { email: 'systeme.public@sgm-cem.local' },
    update: {},
    create: {
      memberId: 'SYS-PUBLIC',
      firstName: 'Contributions',
      lastName: 'Publiques',
      fullName: 'Contributions publiques',
      email: 'systeme.public@sgm-cem.local',
      passwordHash: 'disabled',
      role: 'MEMBRE',
      isActive: false,
      mustChangePassword: false,
    },
  })
  publicAuditUserId = user.id
  return user.id
}

/**
 * Notification et identité d'audit du contributeur — appelées uniquement par le
 * gagnant de la course (count === 1), donc une seule fois par contribution.
 */
async function notifyContributeur(
  contributionId: string,
  issue: 'success' | 'failed',
  receiptUrl: string | null,
  auditAction: 'CONFIRM' | 'REJECT',
  auditDetails: Prisma.InputJsonValue,
  // Lot réparti : audit par ligne, mais UN seul message au payeur (montant total)
  options: { notify: boolean; batchTotal?: number } = { notify: true },
): Promise<void> {
  const contribution = await prisma.contribution.findUnique({
    where: { id: contributionId },
    include: {
      membre: {
        include: {
          user: { select: { id: true, whatsappPhone: true, phone: true, fullName: true, email: true } },
        },
      },
      contributeurExterne: { select: { phone: true, nom: true } },
      rubrique: { select: { title: true, code: true } },
    },
  })
  if (!contribution) return

  try {
    const userId = contribution.membre?.user.id ?? await getPublicAuditUserId()
    const userName = contribution.membre?.user.fullName
      ?? contribution.contributeurExterne?.nom
      ?? 'Contributions publiques'
    await audit({
      userId,
      userName,
      action: auditAction,
      entityType: 'Contribution',
      entityId: contribution.id,
      details: auditDetails,
    })
  } catch (e) {
    console.error('[PaymentStatus] Résolution de l’identité d’audit échouée', e)
  }

  if (!options.notify) return
  const phone = contribution.membre?.user.whatsappPhone ?? contribution.membre?.user.phone ?? contribution.contributeurExterne?.phone
  const memberName = contribution.membre?.user.fullName ?? contribution.contributeurExterne?.nom ?? 'Contributeur'
  const montant = options.batchTotal ?? contribution.montant
  const rubriqueLabel = options.batchTotal ? 'paiement réparti sur plusieurs rubriques' : contribution.rubrique.title

  // Membre avec compte : in-app + WhatsApp (reçu joint) + e-mail
  if (issue === 'success' && contribution.membre) {
    await notifyMemberConfirmed({
      userId: contribution.membre.user.id,
      memberPhone: phone,
      memberEmail: contribution.membre.user.email,
      memberName,
      montant,
      rubriqueCode: options.batchTotal ? 'Paiement réparti' : contribution.rubrique.code,
      receiptUrl,
      contributionId: contribution.id,
    })
    return
  }
  if (!phone) return

  // Notifications affichent le montant DÛ à la rubrique (§1bis), pas le montant majoré.
  const montantStr = montant.toLocaleString('fr-FR')

  if (issue === 'success') {
    const msg = `CEM Melen - Paiement confirmé\nMembre: ${memberName}\nMontant: ${montantStr} FCFA\nRubrique: ${rubriqueLabel}\nMerci pour votre contribution !`
    let sent = false
    if (receiptUrl) sent = await sendWhatsAppDocument(phone, receiptUrl, msg)
    if (!sent) await sendWhatsApp(phone, msg)
  } else {
    const msg = `CEM Melen - Paiement échoué\nMembre: ${memberName}\nMontant: ${montantStr} FCFA\nRubrique: ${rubriqueLabel}\nRéessayez ou contactez un collecteur.`
    await sendWhatsApp(phone, msg)
  }
}
