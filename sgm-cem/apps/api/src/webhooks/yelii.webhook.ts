import { Router } from 'express'
import express from 'express'
import { verifyYeliiSignature } from '../services/yelii.service'
import { applyProviderOutcome } from '../services/payment-status.service'
import { linkOrphanYeliiTransaction } from '../services/payment-attempt.service'
import { recordIncident } from '../services/incident.service'

const router = Router()

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
    void recordIncident('WEBHOOK', 'yelii', 'Signature invalide : secret YELII_WEBHOOK_SECRET à vérifier')
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
  const outcome = SUCCESS_STATUSES.has(status) ? 'success' : FAILED_STATUSES.has(status) ? 'failed' : null
  if (!outcome) {
    console.warn(`[Yelii] ${transactionId} — statut non géré: "${status}"`)
    return
  }

  // Moteur commun (sondage, webhooks, réconciliation) : toutes les lignes de la
  // transaction (paiement réparti) sont traitées ensemble, une seule fois.
  try {
    let result = await applyProviderOutcome(transactionId, {
      provider: 'yelii', status: outcome, amount, netCredited, source: 'webhook',
    })
    // Identifiant inconnu : initiation dont la réponse s'était perdue ?
    if (result === 'unknown_transaction' && outcome === 'success'
      && await linkOrphanYeliiTransaction(transactionId, { amount, senderPhone: envelope.data.senderPhone })) {
      result = await applyProviderOutcome(transactionId, {
        provider: 'yelii', status: outcome, amount, netCredited, source: 'webhook',
      })
    }
    console.info(`[Yelii] ${transactionId} — ${result}`)
  } catch (e) {
    console.error(`[Yelii] Échec du traitement de ${transactionId}`, e)
    await recordIncident('WEBHOOK', 'yelii', e)
  }
}

export default router
