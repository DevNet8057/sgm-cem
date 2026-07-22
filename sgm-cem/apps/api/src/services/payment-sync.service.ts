import { getPrisma } from '../lib/prisma'
import { getYeliiStatus } from './yelii.service'
import { generateReceiptPDF } from './receipt'

const YELII_MODES = ['MTN_MOMO', 'ORANGE_MONEY', 'YELII']

export interface PaymentStatusResult {
  id: string
  statut: string
  paymentStatus: string | null
  receiptUrl: string | null
}

/**
 * Vérifie et synchronise le statut d'une contribution Mobile Money auprès de
 * Yelii si elle est encore en attente. Appelé à chaque poll frontend
 * (`/payments/status/:id`, toutes les 5s) — évite de dépendre uniquement du
 * webhook (souvent injoignable en dev) ou du cron de réconciliation (filet
 * de sécurité à ~1 min, pour le cas où l'onglet est fermé).
 *
 * `getYeliiStatus` retourne 'failed' sur erreur réseau transitoire — assumé
 * tel quel (comportement déjà utilisé par le webhook et la réconciliation),
 * le filet de sécurité rattrape un faux négatif éventuel.
 */
export async function syncYeliiPaymentStatus(contributionId: string): Promise<PaymentStatusResult | null> {
  const prisma = getPrisma()
  const contribution = await prisma.contribution.findUnique({
    where: { id: contributionId },
    select: {
      id: true,
      statut: true,
      paymentStatus: true,
      modePaiement: true,
      externalTransactionId: true,
      referencePaiement: true,
      receiptUrl: true,
    },
  })

  if (!contribution) return null

  if (contribution.statut === 'CONFIRME' || contribution.statut === 'ANNULE' || contribution.statut === 'LITIGE') {
    return {
      id: contribution.id,
      statut: contribution.statut,
      paymentStatus: contribution.paymentStatus,
      receiptUrl: contribution.receiptUrl,
    }
  }

  if (
    YELII_MODES.includes(contribution.modePaiement) &&
    contribution.externalTransactionId &&
    contribution.statut === 'EN_ATTENTE_CONFIRMATION'
  ) {
    const remoteStatus = await getYeliiStatus(contribution.externalTransactionId)

    if (remoteStatus === 'success') {
      const updated = await prisma.contribution.update({
        where: { id: contribution.id },
        data: {
          statut: 'CONFIRME',
          paymentStatus: 'SUCCESS',
          confirmedAt: new Date(),
          localisationFonds: 'REMIS_TRESORIER',
          referencePaiement: contribution.referencePaiement ?? contribution.externalTransactionId,
        },
      })
      const url = await generateReceiptPDF(updated.id)
      return {
        id: updated.id,
        statut: updated.statut,
        paymentStatus: updated.paymentStatus,
        receiptUrl: url ?? updated.receiptUrl,
      }
    }

    if (remoteStatus === 'failed' || remoteStatus === 'cancelled') {
      const updated = await prisma.contribution.update({
        where: { id: contribution.id },
        data: {
          statut: 'ANNULE',
          paymentStatus: 'FAILED',
          litigeMotif: 'Paiement Yelii échoué ou annulé.',
        },
      })
      return {
        id: updated.id,
        statut: updated.statut,
        paymentStatus: updated.paymentStatus,
        receiptUrl: updated.receiptUrl,
      }
    }
  }

  return {
    id: contribution.id,
    statut: contribution.statut,
    paymentStatus: contribution.paymentStatus,
    receiptUrl: contribution.receiptUrl,
  }
}
