import type { Prisma } from '@prisma/client'
import { getPrisma } from '../lib/prisma'
import { getYeliiTransaction } from './yelii.service'
import { generateReceiptPDF } from './receipt'
import { broadcastToAll } from '../lib/socket'
import { sendWhatsApp, sendWhatsAppDocument, alertTresoriers } from './notification'
import { audit } from './audit.service'

/**
 * Synchronisation du statut d'une contribution Mobile Money avec Yelii — repli
 * du webhook (qui n'arrive jamais en dev local, et peut être en retard/perdu
 * en production). Consommé par les routes de polling `GET .../payment-status`.
 *
 * Arbitrages assumés, iso `yelii.webhook.ts` / ancien handler de `contributions.ts` :
 * - `audit()` en best-effort (`void`, ne bloque jamais la réponse) sur les transitions
 *   CONFIRME/ANNULE, avec un userId système dédié — cette route pouvait transitionner
 *   silencieusement une contribution alors qu'elle semblait en lecture seule.
 * - notification WhatsApp : ce service gagne quasi systématiquement la course
 *   contre le webhook (confirmation en ~5 s), qui sort alors sur sa garde
 *   d'idempotence sans rien notifier. Le gagnant du `updateMany` (`count === 1`)
 *   est donc l'unique émetteur légitime — c'est lui qui notifie ici, pas le webhook.
 * - pas de `getConfig()` ici : toute la config Yelii est encapsulée dans yelii.service.ts.
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
// Déduplication des appels en vol : un même transactionId n'appelle jamais Yelii
// deux fois en parallèle (plusieurs onglets ouverts sur le même paiement).
const inFlight = new Map<string, Promise<PaymentStatusSyncResult>>()
// Garde anti-spam pour l'alerte trésoriers sur montant incohérent (Cas 4) : contrairement
// au webhook qui ne passe qu'une fois, ce code est atteint toutes les 5 s tant que le
// client poll — sans cette garde, ~12 alertes/minute seraient envoyées. Portée intra-
// processus volontairement : un redémarrage peut au pire réémettre une alerte, ce qui
// est acceptable et plus sûr que de risquer de ne jamais alerter.
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

export async function syncYeliiContributionStatus(
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
  // ESPECES, VIREMENT et CARTE_VISA/CinetPay : aucune consultation de statut n'existe pour ces modes.
  if (!txId || !YELII_MODES.has(contribution.modePaiement)) return snapshot

  const pending = inFlight.get(txId)
  if (pending) return pending

  const task = runSync(contribution, txId, snapshot).finally(() => { inFlight.delete(txId) })
  inFlight.set(txId, task)
  return task
}

async function runSync(
  contribution: SyncableContribution,
  txId: string,
  snapshot: PaymentStatusSyncResult
): Promise<PaymentStatusSyncResult> {
  try {
    const remote = await getYeliiTransaction(txId)
    if (remote.status === 'processing' || remote.status === 'unknown') return snapshot // aucune écriture

    if (remote.status === 'success') {
      // §Cas 4 — iso webhook : Yelii renvoie le montant MAJORÉ (§1bis), on le compare
      // à amountChargedToPayer (fallback montant pour l'historique/espèces).
      const expectedCharged = contribution.amountChargedToPayer ?? contribution.montant
      if (remote.amount != null && remote.amount !== expectedCharged) {
        console.warn(`[PaymentStatus] Montant incohérent pour ${txId} : attendu ${expectedCharged}, reçu ${remote.amount}`)
        if (!mismatchAlerted.has(txId)) {
          await alertTresoriers(
            'Montant incohérent — paiement Mobile Money',
            `${expectedCharged.toLocaleString('fr-FR')} FCFA attendu, ${remote.amount.toLocaleString('fr-FR')} FCFA reçu (transaction ${txId})`,
            { contributionId: contribution.id, transactionId: txId, expectedAmount: expectedCharged, receivedAmount: remote.amount },
            { view: 'contributions', id: contribution.id }
          )
          mismatchAlerted.add(txId)
        }
        return snapshot
      }

      const { count } = await prisma.contribution.updateMany({
        where: { id: contribution.id, statut: 'EN_ATTENTE_CONFIRMATION' },
        data: {
          statut: 'CONFIRME',
          confirmedAt: new Date(),
          paymentStatus: 'SUCCESS',
          netAmount: remote.netCredited ?? null,
          localisationFonds: 'REMIS_TRESORIER',
          referencePaiement: contribution.referencePaiement ?? txId,
        },
      })

      if (count === 1) {
        // Gagnant de la course — seul appelant à générer le reçu et à diffuser l'événement.
        const receiptUrl = await generateReceiptPDF(contribution.id)
        broadcastToAll('contribution:confirmed', { contributionId: contribution.id, rubriqueId: contribution.rubriqueId })
        void notifyContributeur(contribution.id, 'success', receiptUrl ?? null).catch((e: unknown) => console.error('[PaymentStatus] Notification échouée', e))
        void audit({
          userId: 'system-yelii-sync',
          userName: 'Synchronisation Yelii (polling)',
          action: 'CONFIRM',
          entityType: 'Contribution',
          entityId: contribution.id,
          details: { transactionId: txId, source: 'payment_status_poll', netAmount: remote.netCredited ?? null },
        })
        return { id: contribution.id, statut: 'CONFIRME', paymentStatus: 'SUCCESS', receiptUrl: receiptUrl ?? null }
      }

      // Perdant (webhook, job de réconciliation ou autre requête déjà passés) — relire l'état réel.
      const current = await prisma.contribution.findUnique({
        where: { id: contribution.id },
        select: { id: true, statut: true, paymentStatus: true, receiptUrl: true },
      })
      return current ? { id: current.id, statut: current.statut, paymentStatus: current.paymentStatus, receiptUrl: current.receiptUrl ?? null } : snapshot
    }

    // remote.status === 'failed'
    const { count } = await prisma.contribution.updateMany({
      where: { id: contribution.id, statut: 'EN_ATTENTE_CONFIRMATION' },
      data: { statut: 'ANNULE', paymentStatus: 'FAILED', litigeMotif: 'Paiement Yelii échoué ou annulé.' },
    })

    if (count === 1) {
      void notifyContributeur(contribution.id, 'failed', null).catch((e: unknown) => console.error('[PaymentStatus] Notification échouée', e))
      void audit({
        userId: 'system-yelii-sync',
        userName: 'Synchronisation Yelii (polling)',
        action: 'REJECT',
        entityType: 'Contribution',
        entityId: contribution.id,
        details: { transactionId: txId, source: 'payment_status_poll' },
      })
      return { id: contribution.id, statut: 'ANNULE', paymentStatus: 'FAILED', receiptUrl: snapshot.receiptUrl }
    }

    const current = await prisma.contribution.findUnique({
      where: { id: contribution.id },
      select: { id: true, statut: true, paymentStatus: true, receiptUrl: true },
    })
    return current ? { id: current.id, statut: current.statut, paymentStatus: current.paymentStatus, receiptUrl: current.receiptUrl ?? null } : snapshot
  } catch (e) {
    // Cette route est appelée toutes les 5 secondes en polling — une erreur Prisma
    // ou Puppeteer ne doit jamais produire un 500 côté client.
    console.error('[PaymentStatus]', e)
    return snapshot
  }
}

/**
 * Notification WhatsApp du contributeur — appelée uniquement par le gagnant de la
 * course (count === 1), donc une seule fois par contribution : le coût d'une requête
 * dédiée est négligeable et n'impacte pas le polling. Logique et libellés iso `yelii.webhook.ts`.
 */
async function notifyContributeur(
  contributionId: string,
  issue: 'success' | 'failed',
  receiptUrl: string | null
): Promise<void> {
  const contribution = await prisma.contribution.findUnique({
    where: { id: contributionId },
    include: {
      membre: {
        include: {
          user: { select: { whatsappPhone: true, phone: true, fullName: true } },
        },
      },
      contributeurExterne: { select: { phone: true, nom: true } },
      rubrique: { select: { title: true } },
    },
  })
  if (!contribution) return

  const phone = contribution.membre?.user.whatsappPhone ?? contribution.membre?.user.phone ?? contribution.contributeurExterne?.phone
  if (!phone) return

  const memberName = contribution.membre?.user.fullName ?? contribution.contributeurExterne?.nom ?? 'Contributeur'
  // Notifications affichent le montant DÛ à la rubrique (§1bis), pas le montant majoré.
  const montantStr = contribution.montant.toLocaleString('fr-FR')

  if (issue === 'success') {
    const msg = `CEM Melen - Paiement confirmé\nMembre: ${memberName}\nMontant: ${montantStr} FCFA\nRubrique: ${contribution.rubrique.title}\nMerci pour votre contribution !`
    let sent = false
    if (receiptUrl) sent = await sendWhatsAppDocument(phone, receiptUrl, msg)
    if (!sent) await sendWhatsApp(phone, msg)
  } else {
    const msg = `CEM Melen - Paiement échoué\nMembre: ${memberName}\nMontant: ${montantStr} FCFA\nRubrique: ${contribution.rubrique.title}\nRéessayez ou contactez un collecteur.`
    await sendWhatsApp(phone, msg)
  }
}
