import express, { Router } from 'express'
import {
  verifyCinetpaySignature,
  verifyCinetpayTransaction,
  type CinetpayVerificationResponse,
} from '../services/cinetpay.service'
import { getPrisma } from '../lib/prisma'
import { applyProviderOutcome, cinetpayRemoteState } from '../services/payment-status.service'

const router = Router()
const prisma = getPrisma()


/** CinetPay utilise cette route GET pour vérifier que l’URL de notification répond. */
router.get('/cinetpay', (_req, res) => {
  res.status(200).send('OK')
})

/**
 * CinetPay envoie ses webhooks en application/x-www-form-urlencoded.
 * Cette route doit être enregistrée AVANT express.json() dans index.ts.
 */
router.post('/cinetpay', express.urlencoded({ extended: false }), async (req, res) => {
  const body = req.body as Record<string, string | undefined>
  const receivedToken = req.get('x-token')

  if (!verifyCinetpaySignature(body, receivedToken)) {
    console.error('[CinetPay Webhook] Signature invalide — requête rejetée')
    return res.status(401).send('Signature invalide')
  }

  const transactionId = body.cpm_trans_id?.trim()
  if (!transactionId) {
    console.warn('[CinetPay Webhook] Identifiant de transaction manquant')
    return res.status(400).send('Identifiant de transaction manquant')
  }

  // Transaction connue et encore en attente ? (évite un appel distant inutile)
  const pending = await prisma.contribution.count({
    where: { externalTransactionId: transactionId, statut: 'EN_ATTENTE_CONFIRMATION' },
  })
  if (pending === 0) {
    console.info(`[CinetPay Webhook] Transaction ${transactionId} inconnue ou déjà traitée`)
    return res.status(200).send('OK')
  }

  // Source de vérité : /payment/check, jamais le contenu du webhook
  let verification: CinetpayVerificationResponse
  try {
    verification = await verifyCinetpayTransaction(transactionId)
  } catch (error) {
    console.error(`[CinetPay Webhook] Vérification distante impossible pour ${transactionId}`, error)
    return res.status(503).send('Vérification CinetPay temporairement indisponible')
  }

  try {
    const remote = cinetpayRemoteState(verification)
    if (remote.status === 'success' || remote.status === 'failed') {
      const result = await applyProviderOutcome(transactionId, { ...remote, status: remote.status, source: 'webhook' })
      console.info(`[CinetPay Webhook] ${transactionId} — ${result}`)
    }
    return res.status(200).send('OK')
  } catch (error) {
    console.error(`[CinetPay Webhook] Échec du traitement de ${transactionId}`, error)
    return res.status(500).send('Erreur de traitement CinetPay')
  }
})

export default router
