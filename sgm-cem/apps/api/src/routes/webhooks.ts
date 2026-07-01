import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import { notifyMemberConfirmed } from '../services/notification'

const router = Router()
const prisma = new PrismaClient()

// ── MTN MoMo webhook ─────────────────────────────────────────────────
router.post('/mtn', async (req, res) => {
  // Vérification signature MTN (X-Callback-Url header)
  const secret     = process.env.MTN_WEBHOOK_SECRET
  const signature  = req.headers['x-callback-signature'] as string | undefined
  const body       = JSON.stringify(req.body)

  if (secret && signature) {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
    if (signature !== expected) {
      res.status(401).json({ error: 'Invalid signature' })
      return
    }
  }

  const { referenceId, status, financialTransactionId } = req.body

  if (!referenceId) { res.sendStatus(200); return }

  // Chercher la contribution avec ce transactionId
  const contribution = await prisma.contribution.findFirst({
    where: { momoTransactionId: referenceId },
    include: {
      membre: {
        include: { user: { select: { id: true, phone: true, whatsappPhone: true, email: true, fullName: true } } },
      },
      rubrique: { select: { code: true } },
    },
  })

  if (!contribution) { res.sendStatus(200); return }

  if (status === 'SUCCESSFUL' && contribution.statut === 'EN_ATTENTE_CONFIRMATION') {
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: {
        statut:            'CONFIRME',
        confirmedAt:       new Date(),
        referencePaiement: financialTransactionId ?? referenceId,
      },
    })

    await prisma.auditLog.create({
      data: {
        userId:     'webhook-mtn',
        userName:   'MTN MoMo Webhook',
        action:     'CONFIRM',
        entityType: 'Contribution',
        entityId:   contribution.id,
        details:    { referenceId, financialTransactionId, source: 'webhook' },
      },
    })

    // Notifier le membre
    try {
      const phone = contribution.membre?.user.whatsappPhone ?? contribution.membre?.user.phone
      const email = contribution.membre?.user.email
      await notifyMemberConfirmed({
        userId:       contribution.membre!.user.id,
        memberPhone:  phone,
        memberEmail:  email,
        memberName:   contribution.membre!.user.fullName,
        montant:      contribution.montant,
        rubriqueCode: contribution.rubrique?.code ?? '',
        contributionId: contribution.id,
      })
    } catch (e) { console.error('[Webhook MTN notif]', e) }
  }

  if (status === 'FAILED' && contribution.statut === 'EN_ATTENTE_CONFIRMATION') {
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: { statut: 'ANNULE', litigeMotif: 'Paiement MTN MoMo échoué ou refusé.' },
    })
  }

  res.sendStatus(200)
})

// ── Orange Money webhook ──────────────────────────────────────────────
router.post('/orange', async (req, res) => {
  const { status, order_id, txnid } = req.body

  if (!order_id) { res.sendStatus(200); return }

  const contribution = await prisma.contribution.findFirst({
    where: { momoTransactionId: order_id },
    include: {
      membre: {
        include: { user: { select: { id: true, phone: true, whatsappPhone: true, email: true, fullName: true } } },
      },
      rubrique: { select: { code: true } },
    },
  })

  if (!contribution) { res.sendStatus(200); return }

  if (status === 'SUCCESS' && contribution.statut === 'EN_ATTENTE_CONFIRMATION') {
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: {
        statut:            'CONFIRME',
        confirmedAt:       new Date(),
        referencePaiement: txnid ?? order_id,
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: 'webhook-orange', userName: 'Orange Money Webhook',
        action: 'CONFIRM', entityType: 'Contribution', entityId: contribution.id,
        details: { order_id, txnid, source: 'webhook' },
      },
    })

    try {
      const phone = contribution.membre?.user.whatsappPhone ?? contribution.membre?.user.phone
      const email = contribution.membre?.user.email
      await notifyMemberConfirmed({
        userId:       contribution.membre!.user.id,
        memberPhone:  phone,
        memberEmail:  email,
        memberName:   contribution.membre!.user.fullName,
        montant:      contribution.montant,
        rubriqueCode: contribution.rubrique?.code ?? '',
        contributionId: contribution.id,
      })
    } catch (e) { console.error('[Webhook Orange notif]', e) }
  }

  res.sendStatus(200)
})

// ── Orange return/cancel (redirect URLs) ─────────────────────────────
router.get('/orange/return',  (_req, res) => res.redirect(`${process.env.APP_URL}/dashboard?payment=success`))
router.get('/orange/cancel',  (_req, res) => res.redirect(`${process.env.APP_URL}/dashboard?payment=cancel`))

// ── Yelii webhook (HMAC-SHA512: HMAC(yeliiApiKey, timestamp + rawBody)) ─
router.post('/yelii', async (req, res) => {
  const signature  = req.headers['x-yelii-signature'] as string | undefined
  const timestamp  = req.headers['x-yelii-timestamp'] as string | undefined
  const body       = JSON.stringify(req.body)
  const secret     = process.env.YELII_WEBHOOK_SECRET || process.env.YELII_COLLECT_API_KEY || process.env.YELII_API_KEY

  if (secret) {
    if (!signature || !timestamp) {
      res.status(401).json({ error: 'Missing Yelii signature' })
      return
    }

    if (Math.abs(Date.now() - Number(timestamp)) > 300000) {
      res.status(401).json({ error: 'Expired Yelii signature' })
      return
    }

    const message = `${timestamp}${body}`
    const expected = crypto.createHmac('sha512', secret).update(message).digest('hex')
    const receivedBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expected, 'hex')
    if (receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
      res.status(401).json({ error: 'Invalid Yelii signature' })
      return
    }
  }

  const event = req.body?.event
  const payload = req.body?.data ?? req.body
  if (event && event !== 'collect.transaction.updated') {
    res.sendStatus(200)
    return
  }

  const {
    transactionId,
    externalId,
    partnerReference,
    yeliiReference,
    status,
    amount,
    senderPhone,
    channel,
    commissionAmount,
    netCredited,
  } = payload

  if (!transactionId && !externalId && !partnerReference && !yeliiReference) { res.sendStatus(200); return }

  const contribution = await prisma.contribution.findFirst({
    where: {
      OR: [
        ...(transactionId ? [{ momoTransactionId: transactionId }] : []),
        ...(yeliiReference ? [{ momoTransactionId: yeliiReference }] : []),
        ...(externalId ? [{ referencePaiement: externalId }] : []),
        ...(partnerReference ? [{ referencePaiement: partnerReference }] : []),
      ],
    },
    include: {
      membre: {
        include: { user: { select: { id: true, phone: true, whatsappPhone: true, email: true, fullName: true } } },
      },
      rubrique: { select: { code: true } },
    },
  })

  if (!contribution) { res.sendStatus(200); return }

  const yeliiStatus = String(status ?? 'processing').toLowerCase()

  if ((yeliiStatus === 'success' || yeliiStatus === 'successful') && contribution.statut === 'EN_ATTENTE_CONFIRMATION') {
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: {
        statut:            'CONFIRME',
        confirmedAt:       new Date(),
        referencePaiement: transactionId ?? yeliiReference ?? partnerReference ?? externalId,
      },
    })

    await prisma.auditLog.create({
      data: {
        userId:     contribution.collecteurId ?? contribution.membre.user.id,
        userName:   'Yelii Webhook',
        action:     'CONFIRM',
        entityType: 'Contribution',
        entityId:   contribution.id,
        details:    { transactionId, externalId, partnerReference, yeliiReference, status, channel, amount, senderPhone, commissionAmount, netCredited, source: 'webhook' },
      },
    })

    try {
      const phone = contribution.membre?.user.whatsappPhone ?? contribution.membre?.user.phone
      const email = contribution.membre?.user.email
      await notifyMemberConfirmed({
        userId:       contribution.membre!.user.id,
        memberPhone:  phone,
        memberEmail:  email,
        memberName:   contribution.membre!.user.fullName,
        montant:      contribution.montant,
        rubriqueCode: contribution.rubrique?.code ?? '',
        contributionId: contribution.id,
      })
    } catch (e) { console.error('[Webhook Yelii notif]', e) }
  }

  if ((yeliiStatus === 'failed' || yeliiStatus === 'cancelled') && contribution.statut === 'EN_ATTENTE_CONFIRMATION') {
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: { statut: 'ANNULE', litigeMotif: `Paiement Yelii échoué (${channel ?? 'inconnu'}).` },
    })
  }

  res.sendStatus(200)
})

export { router as webhooksRouter }
