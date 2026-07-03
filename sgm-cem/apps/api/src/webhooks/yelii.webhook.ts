import { Router } from 'express'
import express from 'express'
import { verifyYeliiSignature } from '../services/yelii.service'
import { getPrisma } from '../lib/prisma'
import { generateReceiptPDF } from '../services/receipt'
import { sendWhatsAppDocument, sendWhatsApp, alertTresoriers } from '../services/notification'

const router = Router()
const prisma = getPrisma()

/**
 * POST /webhooks/yelii
 *
 * Enregistré AVANT express.json() dans index.ts.
 * Utilise express.json() au niveau de la route, puis JSON.stringify(req.body)
 * pour la vérification de signature — conforme à la documentation Yelii :
 *   HMAC_SHA512(collectApiKey, timestamp + JSON.stringify(parsedBody))
 *
 * NE PAS utiliser express.raw() : Yelii signe le JSON sérialisé, pas les bytes bruts.
 */
router.post('/yelii', express.json(), async (req, res) => {
  // Re-sérialiser le body parsé — c'est ce que Yelii a signé (format compact, sans espaces)
  const bodyStr = JSON.stringify(req.body)

  // 1. Vérifier la signature — TOUJOURS EN PREMIER
  const isValid = verifyYeliiSignature(
    req.headers as Record<string, string>,
    bodyStr
  )
  if (!isValid) {
    console.error('[Yelii Webhook] Signature invalide — rejeté')
    return res.status(401).json({ error: 'Signature invalide' })
  }

  // 2. Répondre 200 à Yelii IMMÉDIATEMENT (règle : < 30 secondes)
  res.json({ received: true })

  // 3. Traitement asynchrone en arrière-plan
  const envelope = req.body as YeliiEnvelope
  setImmediate(() => processYeliiWebhook(envelope))
})

type YeliiEnvelope = {
  event: string
  data: {
    transactionId: string
    status: 'success' | 'completed' | 'successful' | 'failed' | 'cancelled' | 'processing'
    amount?: number
    commissionAmount?: number
    netCredited?: number
    channel?: string
    senderPhone?: string
    updatedAt?: string
  }
}

// Yelii utilise plusieurs libellés selon l'endpoint (webhook vs /collect/status) :
// "success"/"successful"/"completed" pour un paiement abouti, "failed"/"cancelled" pour un échec.
const SUCCESS_STATUSES = new Set(['success', 'successful', 'completed'])
const FAILED_STATUSES = new Set(['failed', 'cancelled'])

async function processYeliiWebhook(envelope: YeliiEnvelope) {
  if (envelope.event !== 'collect.transaction.updated') return

  const { transactionId, status, amount, netCredited } = envelope.data

  const contribution = await prisma.contribution.findFirst({
    where: { externalTransactionId: transactionId },
    include: {
      membre: {
        include: {
          user: { select: { id: true, phone: true, whatsappPhone: true, fullName: true } },
        },
      },
      rubrique: { select: { title: true, code: true } },
    },
  })

  if (!contribution) {
    console.warn(`[Yelii] Transaction ${transactionId} inconnue`)
    return
  }

  // Idempotence — RB-12
  if (
    contribution.paymentStatus === 'SUCCESS' ||
    contribution.paymentStatus === 'FAILED' ||
    contribution.statut === 'CONFIRME' ||
    contribution.statut === 'ANNULE'
  ) {
    console.info(`[Yelii] ${transactionId} déjà traitée — ignorée`)
    return
  }

  const memberPhone = contribution.membre?.user.whatsappPhone ?? contribution.membre?.user.phone
  const memberName = contribution.membre?.user.fullName ?? 'Membre'
  // Notifications et reçu affichent le montant DÛ à la rubrique (§1bis), pas le montant majoré.
  const montantStr = contribution.montant.toLocaleString('fr-FR')

  // Cas 4 — montant reçu incohérent : Yelii renvoie le montant MAJORÉ (§1bis),
  // on compare donc à amountChargedToPayer (fallback montant pour l'historique/espèces).
  const expectedCharged = contribution.amountChargedToPayer ?? contribution.montant
  if (SUCCESS_STATUSES.has(status) && amount != null && amount !== expectedCharged) {
    console.warn(`[Yelii] Montant incohérent pour ${transactionId} : attendu ${expectedCharged}, reçu ${amount}`)
    await alertTresoriers(
      'Montant incohérent — paiement Mobile Money',
      `${memberName} · attendu ${expectedCharged.toLocaleString('fr-FR')} FCFA, reçu ${amount.toLocaleString('fr-FR')} FCFA (transaction ${transactionId})`,
      { contributionId: contribution.id, transactionId, expectedAmount: expectedCharged, receivedAmount: amount }
    )
    return
  }

  if (SUCCESS_STATUSES.has(status)) {
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: {
        statut: 'CONFIRME',
        confirmedAt: new Date(), // RB-01 : horodatage serveur
        paymentStatus: 'SUCCESS',
        netAmount: netCredited ?? null,
        // Paiement Mobile Money : l'argent est crédité directement dans le wallet
        // Yelii de l'organisation, géré par le trésorier — aucun collecteur ne le
        // détient physiquement, donc pas de EN_TRANSIT/CHEZ_COLLECTEUR ici.
        localisationFonds: 'REMIS_TRESORIER',
      },
    })

    const receiptUrl = await generateReceiptPDF(contribution.id)
    const msg = `CEM Melen - Paiement confirmé\nMembre: ${memberName}\nMontant: ${montantStr} FCFA\nRubrique: ${contribution.rubrique.title}\nMerci pour votre contribution !`

    if (memberPhone && receiptUrl) {
      await sendWhatsAppDocument(memberPhone, receiptUrl, msg)
    } else if (memberPhone) {
      await sendWhatsApp(memberPhone, msg)
    }

    console.info(`[Yelii] ✅ ${transactionId} — confirmé (net: ${netCredited} FCFA)`)
  } else if (FAILED_STATUSES.has(status)) {
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: { statut: 'ANNULE', paymentStatus: 'FAILED' },
    })

    if (memberPhone) {
      const failedMsg = `CEM Melen - Paiement échoué\nMembre: ${memberName}\nMontant: ${montantStr} FCFA\nRubrique: ${contribution.rubrique.title}\nRéessayez ou contactez un collecteur.`
      await sendWhatsApp(memberPhone, failedMsg)
    }

    console.info(`[Yelii] ❌ ${transactionId} — échoué`)
  } else {
    console.warn(`[Yelii] ${transactionId} — statut non géré: "${status}"`)
  }
}

export default router
