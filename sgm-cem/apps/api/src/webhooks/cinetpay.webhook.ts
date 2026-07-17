import { Router } from 'express'
import express from 'express'
import { verifyCinetpaySignature } from '../services/cinetpay.service'
import { getPrisma } from '../lib/prisma'
import { generateReceiptPDF } from '../services/receipt'
import { sendWhatsAppDocument, sendWhatsApp, alertTresoriers } from '../services/notification'

const router = Router()
const prisma = getPrisma()

/**
 * CinetPay envoie ses webhooks en application/x-www-form-urlencoded.
 * Cette route doit être enregistrée AVANT express.json() dans index.ts.
 */
router.post('/cinetpay', express.urlencoded({ extended: false }), async (req, res) => {
  const body = req.body as Record<string, string>

  // 1. Vérifier la signature MD5
  if (!verifyCinetpaySignature(body)) {
    console.error('[CinetPay Webhook] Signature invalide — rejeté')
    return res.status(401).send('Signature invalide')
  }

  // 2. Répondre 200 IMMÉDIATEMENT
  res.send('OK')

  // 3. Traitement asynchrone
  setImmediate(() => processCinetpayWebhook(body))
})

async function processCinetpayWebhook(body: Record<string, string>) {
  const { cpm_trans_id, cpm_result, cpm_amount } = body

  const contribution = await prisma.contribution.findFirst({
    where: { externalTransactionId: cpm_trans_id },
    include: {
      membre: {
        include: {
          user: { select: { phone: true, whatsappPhone: true, fullName: true } },
        },
      },
      // contribution publique : pas de membre, notifier le contributeur externe
      contributeurExterne: { select: { phone: true, nom: true } },
      rubrique: { select: { title: true, code: true } },
    },
  })

  if (!contribution) {
    console.warn(`[CinetPay] Transaction ${cpm_trans_id} inconnue`)
    return
  }

  // Idempotence — RB-12
  if (
    contribution.paymentStatus === 'SUCCESS' ||
    contribution.paymentStatus === 'FAILED' ||
    contribution.statut === 'CONFIRME' ||
    contribution.statut === 'ANNULE'
  ) {
    console.info(`[CinetPay] ${cpm_trans_id} déjà traitée — ignorée`)
    return
  }

  // contribution publique : pas de membre, notifier le contributeur externe
  const memberPhone = contribution.membre?.user.whatsappPhone ?? contribution.membre?.user.phone ?? contribution.contributeurExterne?.phone
  const memberName = contribution.membre?.user.fullName ?? contribution.contributeurExterne?.nom ?? 'Contributeur'
  const montantNum = Number(cpm_amount ?? contribution.montant)
  const montantStr = montantNum.toLocaleString('fr-FR')

  // Cas 4 — montant reçu incohérent avec le montant initié : ne pas confirmer automatiquement
  if (cpm_result === '00' && montantNum !== contribution.montant) {
    console.warn(`[CinetPay] Montant incohérent pour ${cpm_trans_id} : attendu ${contribution.montant}, reçu ${montantNum}`)
    await alertTresoriers(
      'Montant incohérent — paiement Carte bancaire',
      `${memberName} · attendu ${contribution.montant.toLocaleString('fr-FR')} FCFA, reçu ${montantStr} FCFA (transaction ${cpm_trans_id})`,
      { contributionId: contribution.id, transactionId: cpm_trans_id, expectedAmount: contribution.montant, receivedAmount: montantNum }
    )
    return
  }

  if (cpm_result === '00') {
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: {
        statut: 'CONFIRME',
        confirmedAt: new Date(),
        paymentStatus: 'SUCCESS',
        netAmount: Math.round(montantNum * 0.965), // ~3.5% commission CinetPay
        // Paiement carte bancaire : réglé directement sur le compte marchand
        // CinetPay de l'organisation, géré par le trésorier — aucun collecteur
        // ne le détient physiquement.
        localisationFonds: 'REMIS_TRESORIER',
      },
    })

    const receiptUrl = await generateReceiptPDF(contribution.id)
    const msg = `CEM Melen - Paiement par carte confirmé\nMembre: ${memberName}\nMontant: ${montantStr} FCFA\nRubrique: ${contribution.rubrique.title}\nMerci pour votre contribution !`

    if (memberPhone) {
      let sent = false
      if (receiptUrl) sent = await sendWhatsAppDocument(memberPhone, receiptUrl, msg)
      if (!sent) await sendWhatsApp(memberPhone, msg)
    }

    console.info(`[CinetPay] ✅ Paiement confirmé — ${cpm_trans_id}`)
  } else {
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: { statut: 'ANNULE', paymentStatus: 'FAILED' },
    })

    if (memberPhone) {
      const failedMsg = `CEM Melen - Paiement par carte échoué\nMembre: ${memberName}\nMontant: ${montantStr} FCFA\nRubrique: ${contribution.rubrique.title}\nRéessayez ou contactez un collecteur.`
      await sendWhatsApp(memberPhone, failedMsg)
    }

    console.info(`[CinetPay] ❌ Paiement échoué — ${cpm_trans_id}`)
  }
}

export default router
