import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { initiateYeliiPayment, retryYeliiCallback } from '../services/yelii.service'
import { initiateCinetpayPayment } from '../services/cinetpay.service'
import { generateReceiptPDF } from '../services/receipt'
import { calculateAmountWithCommission, YELII_COMMISSION_RATE } from '@sgm-cem/shared'
import { getPrisma } from '../lib/prisma'
import { getConfigBool, getConfigNumber } from '../services/config.service'

const router = Router()
const prisma = getPrisma()

const initiateSchema = z.object({
  membreId: z.string().min(1),
  rubriqueId: z.string().min(1),
  montant: z.number().int().positive(),
  modePaiement: z.enum(['ESPECES', 'YELII', 'CARTE_VISA']),
  mobileMoneyPhone: z.string().optional(),
  paymentChannel: z.enum(['MTN', 'ORANGE']).optional(),
})

/**
 * POST /api/payments/initiate
 * Initie un paiement selon le mode choisi (espèces, mobile money, carte).
 */
router.post('/initiate', authenticate, requireLevel(2), async (req, res) => {
  const data = initiateSchema.parse(req.body)

  // Protection double-clic : si une contribution PROCESSING existe déjà, la retourner
  const existingProcessing = await prisma.contribution.findFirst({
    where: {
      membreId: data.membreId,
      rubriqueId: data.rubriqueId,
      paymentStatus: 'PROCESSING',
    },
  })

  if (existingProcessing) {
    return res.json({
      success: true,
      data: {
        contributionId: existingProcessing.id,
        transactionId: existingProcessing.externalTransactionId,
        paymentUrl: existingProcessing.paymentUrl,
        status: existingProcessing.paymentStatus,
      },
    })
  }

  // Résoudre le vrai mode pour la traçabilité (MTN_MOMO / ORANGE_MONEY au lieu de YELII)
  type StoredMode = 'ESPECES' | 'MTN_MOMO' | 'ORANGE_MONEY' | 'CARTE_VISA' | 'YELII'
  let storedMode: StoredMode = data.modePaiement as StoredMode
  if (data.modePaiement === 'YELII') {
    storedMode = data.paymentChannel === 'ORANGE' ? 'ORANGE_MONEY' : 'MTN_MOMO'
  }

  const contribution = await prisma.contribution.create({
    data: {
      membreId: data.membreId,
      rubriqueId: data.rubriqueId,
      montant: data.montant,
      modePaiement: storedMode,
      collecteurId: req.user!.userId,
      statut: 'EN_ATTENTE_CONFIRMATION',
      paymentStatus: 'PENDING',
      localisationFonds: data.modePaiement === 'ESPECES' ? 'CHEZ_COLLECTEUR' : 'EN_TRANSIT',
      mobileMoneyPhone: data.mobileMoneyPhone ?? null,
    },
  })

  // ── MODE MOBILE MONEY (Yelii) ─────────────────────────────────────────────
  if (data.modePaiement === 'YELII') {
    // Interrupteur section E du panneau développeur
    if (!getConfigBool('MOBILE_MONEY_ENABLED', true)) {
      await prisma.contribution.update({ where: { id: contribution.id }, data: { paymentStatus: 'FAILED' } })
      return res.status(403).json({ success: false, error: 'Le paiement Mobile Money est temporairement désactivé' })
    }
    if (!data.mobileMoneyPhone || !data.paymentChannel) {
      await prisma.contribution.update({ where: { id: contribution.id }, data: { paymentStatus: 'FAILED' } })
      return res.status(400).json({ success: false, error: 'Numéro de téléphone et réseau requis pour Mobile Money' })
    }

    // §1bis — Le contributeur supporte la commission Yelii de 2,5 %.
    // On envoie à Yelii le montant MAJORÉ (totalToPay), jamais le montant dû brut.
    // Taux effectif lu en base à CHAQUE appel (panneau développeur, section C) —
    // la formule reste unique dans @sgm-cem/shared.
    const { totalToPay, commissionAmount } = calculateAmountWithCommission(
      contribution.montant,
      getConfigNumber('YELII_COMMISSION_RATE', YELII_COMMISSION_RATE)
    )

    const payment = await initiateYeliiPayment({
      amount: totalToPay, // ← montant majoré, PAS contribution.montant
      senderPhone: data.mobileMoneyPhone,
      channel: data.paymentChannel === 'ORANGE' ? 'orange_money' : 'mtn_money',
    })

    if (payment.success && payment.transactionId) {
      await prisma.contribution.update({
        where: { id: contribution.id },
        data: {
          externalTransactionId: payment.transactionId,
          paymentStatus: 'PROCESSING',
          amountChargedToPayer: totalToPay,
          commissionPaidByPayer: commissionAmount,
        },
      })
      return res.json({
        success: true,
        data: {
          contributionId: contribution.id,
          transactionId: payment.transactionId,
          status: 'PROCESSING',
          dueAmount: contribution.montant,
          commissionAmount,
          totalToPay,
        },
      })
    } else {
      await prisma.contribution.update({ where: { id: contribution.id }, data: { paymentStatus: 'FAILED' } })
      return res.json({ success: false, error: payment.message ?? 'Échec du paiement Mobile Money' })
    }
  }

  // ── MODE ESPÈCES — confirmation directe par le collecteur ─────────────────
  if (data.modePaiement === 'ESPECES') {
    // Interrupteur section E du panneau développeur
    if (!getConfigBool('CASH_ENABLED', true)) {
      await prisma.contribution.update({ where: { id: contribution.id }, data: { paymentStatus: 'FAILED' } })
      return res.status(403).json({ success: false, error: 'Le paiement en espèces est temporairement désactivé' })
    }
    // RB-02 exception : espèces confirmées sans webhook car l'argent est physiquement présent
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: {
        statut: 'CONFIRME',
        confirmedAt: new Date(), // RB-01 : horodatage serveur
        paymentStatus: 'SUCCESS',
      },
    })
    await generateReceiptPDF(contribution.id)
    return res.json({
      success: true,
      data: { contributionId: contribution.id, status: 'SUCCESS' },
    })
  }

  // ── MODE CARTE BANCAIRE (CinetPay) ────────────────────────────────────────
  if (data.modePaiement === 'CARTE_VISA') {
    const [membre, rubrique] = await Promise.all([
      prisma.membre.findUnique({
        where: { id: data.membreId },
        include: { user: { select: { firstName: true, lastName: true } } },
      }),
      prisma.rubrique.findUnique({
        where: { id: data.rubriqueId },
        select: { code: true, title: true },
      }),
    ])

    // ID de transaction CinetPay : préfixe SGM + année + id partiel
    const txId = `SGM-${new Date().getFullYear()}-${contribution.id.substring(0, 8).toUpperCase()}`

    try {
      const result = await initiateCinetpayPayment({
        transactionId: txId,
        amount: data.montant,
        description: `Contribution ${rubrique?.code ?? ''} — ${membre?.user.lastName ?? ''} ${membre?.user.firstName ?? ''}`.trim(),
        customerName: membre?.user.lastName ?? 'MEMBRE',
        customerSurname: membre?.user.firstName ?? 'CEM',
      })

      await prisma.contribution.update({
        where: { id: contribution.id },
        data: {
          externalTransactionId: txId,
          paymentStatus: 'PROCESSING',
          paymentUrl: result.paymentUrl,
        },
      })

      return res.json({
        success: true,
        data: {
          contributionId: contribution.id,
          paymentUrl: result.paymentUrl,
          status: 'PROCESSING',
        },
      })
    } catch (err) {
      await prisma.contribution.update({ where: { id: contribution.id }, data: { paymentStatus: 'FAILED' } })
      const message = err instanceof Error ? err.message : 'Erreur CinetPay'
      return res.status(500).json({ success: false, error: message })
    }
  }
})

/**
 * GET /api/payments/config
 * Expose au frontend les paramètres de paiement dynamiques (panneau développeur) :
 * taux de commission Yelii effectif + interrupteurs de mode. Le frontend NE doit
 * plus se fier au taux statique compilé (il peut avoir changé en base).
 */
router.get('/config', authenticate, async (_req, res) => {
  res.json({
    success: true,
    data: {
      yeliiCommissionRate: getConfigNumber('YELII_COMMISSION_RATE', YELII_COMMISSION_RATE),
      mobileMoneyEnabled: getConfigBool('MOBILE_MONEY_ENABLED', true),
      cashEnabled: getConfigBool('CASH_ENABLED', true),
    },
  })
})

/**
 * GET /api/payments/status/:id
 * Polling du statut par ID de contribution (le frontend envoie contrib.id).
 * Accepte aussi externalTransactionId en fallback.
 */
router.get('/status/:id', authenticate, requireLevel(2), async (req, res) => {
  const id = String(req.params.id)

  const contribution = await prisma.contribution.findFirst({
    where: {
      OR: [
        { id },
        { externalTransactionId: id },
      ],
    },
    select: {
      id: true,
      statut: true,
      paymentStatus: true,
      montant: true,
      receiptUrl: true,
    },
  })

  if (!contribution) {
    return res.status(404).json({ success: false, error: 'Contribution inconnue' })
  }

  res.json({
    success: true,
    data: {
      id: contribution.id,
      statut: contribution.statut,
      paymentStatus: contribution.paymentStatus,
      receiptUrl: contribution.receiptUrl ?? null,
    },
  })
})

/**
 * POST /api/payments/retry-webhook/:transactionId
 * Rejoue manuellement le webhook Yelii d'une transaction (Trésorier/Admin).
 * Utile si le serveur était indisponible lors de la notification initiale (section 11 du doc).
 */
router.post('/retry-webhook/:transactionId', authenticate, requireLevel(4), async (req, res) => {
  const transactionId = String(req.params.transactionId)

  const contribution = await prisma.contribution.findFirst({
    where: { externalTransactionId: transactionId },
  })

  if (!contribution) {
    return res.status(404).json({ success: false, error: 'Transaction introuvable' })
  }

  const result = await retryYeliiCallback(transactionId)
  res.json({ success: true, data: result })
})

export { router as paymentsRouter }
