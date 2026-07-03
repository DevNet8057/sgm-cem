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

// Le webhook Yelii vit exclusivement dans apps/api/src/webhooks/yelii.webhook.ts
// (monté sur /webhooks, body brut requis pour la vérification HMAC — voir index.ts).
// Un doublon existait ici avec une logique obsolète (mauvais champ de lookup,
// statuts non reconnus) ; supprimé pour éviter toute confusion future.

export { router as webhooksRouter }
