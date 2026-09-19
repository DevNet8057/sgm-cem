import { Router } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { initiateYeliiPayment, retryYeliiCallback } from '../services/yelii.service'
import { initiateCinetpayPayment, isCinetpayConfigured } from '../services/cinetpay.service'
import { generateReceiptPDF } from '../services/receipt'
import { calculateAmountWithCommission, resolveDueAmount, YELII_COMMISSION_RATE } from '@sgm-cem/shared'
import { getPrisma } from '../lib/prisma'
import { getConfigBool, getConfigNumber } from '../services/config.service'
import { audit } from '../services/audit.service'
import { syncYeliiContributionStatus, CONTRIBUTION_SYNC_SELECT } from '../services/payment-status.service'
import { createPaymentBatch, PaymentBatchError } from '../services/payment-batch.service'

const router = Router()
const prisma = getPrisma()

const initiateSchema = z.object({
  membreId: z.string().min(1),
  rubriqueId: z.string().min(1),
  montant: z.number().int().positive(),
  modePaiement: z.enum(['ESPECES', 'YELII', 'CARTE_VISA']),
  mobileMoneyPhone: z.string().optional(),
  paymentChannel: z.enum(['MTN', 'ORANGE']).optional(),
  customerPhone: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.modePaiement === 'CARTE_VISA' && data.montant % 5 !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['montant'],
      message: 'Le montant du paiement par carte doit être un multiple de 5 FCFA',
    })
  }
})

const initiateBatchSchema = z.object({
  idempotencyKey: z.string(),
  membreId: z.string(),
  budgetAmount: z.number(),
  allocations: z.array(z.object({
    rubriqueId: z.string(),
    montant: z.number(),
  }).strict()),
  modePaiement: z.enum(['YELII', 'CARTE_VISA', 'ESPECES']),
  mobileMoneyPhone: z.string().optional(),
  paymentChannel: z.enum(['MTN', 'ORANGE']).optional(),
  customerPhone: z.string().optional(),
  collecteurId: z.string().optional(),
}).strict()

/**
 * POST /api/payments/initiate
 * Initie un paiement selon le mode choisi (mobile money, carte — staff uniquement
 * pour espèces, voir plus bas).
 *
 * Deux appelants possibles :
 *  - Staff (level ≥ 2) : `membreId` du body est celui d'un membre quelconque,
 *    `collecteurId` = le staff qui traite le paiement (comportement historique).
 *  - MEMBRE (level 1, self-service) : `membreId` du body DOIT correspondre au
 *    membre connecté — toute autre valeur est explicitement rejetée (403), plutôt
 *    que silencieusement substituée, pour ne jamais masquer une tentative de payer
 *    "pour" un autre membre. ESPECES est refusé ici : un paiement en espèces déclaré par un
 *    membre doit passer par POST /contributions/declare (double validation —
 *    un collecteur humain doit confirmer avoir reçu l'argent). `collecteurId`
 *    reste `null` (aucun staff n'a traité ce paiement digital) — pattern déjà
 *    établi par les collectes publiques (routes/public.ts), voir le bucket
 *    "sans-collecteur" dans GET /api/collecteurs.
 */
router.post('/initiate', authenticate, requireLevel(1), async (req, res) => {
  const data = initiateSchema.parse(req.body)
  const isSelfService = req.user!.role === 'MEMBRE'

  if (isSelfService && data.modePaiement === 'ESPECES') {
    throw new AppError(
      'BUSINESS_RULE',
      "Un paiement en espèces doit être déclaré via 'Déclarer un paiement en espèces' — un collecteur doit confirmer l'avoir reçu.",
      400
    )
  }

  let membreId = data.membreId
  if (isSelfService) {
    const membre = await prisma.membre.findFirst({ where: { userId: req.user!.userId }, select: { id: true } })
    if (!membre) throw new AppError('NOT_FOUND', 'Profil membre introuvable pour ce compte', 404)
    if (data.membreId !== membre.id) {
      throw new AppError('ACCESS_DENIED', 'Vous ne pouvez initier un paiement que pour vous-même', 403)
    }
    membreId = membre.id
  }

  const [rubrique, membre] = await Promise.all([
    prisma.rubrique.findUnique({
      where: { id: data.rubriqueId },
      select: {
        code: true,
        title: true,
        status: true,
        amountTravailleur: true,
        amountEtudiant: true,
        amountCouple: true,
      },
    }),
    prisma.membre.findUnique({
      where: { id: membreId },
      select: {
        id: true,
        isActive: true,
        profilFinancier: true,
        phone: true,
        adresse: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    }),
  ])

  if (!rubrique || rubrique.status !== 'OUVERTE') {
    throw new AppError('BUSINESS_RULE', 'Rubrique fermée ou introuvable')
  }
  if (!membre || !membre.isActive) {
    throw new AppError('NOT_FOUND', 'Membre introuvable ou inactif', 404)
  }

  const montantAttendu = resolveDueAmount(membre.profilFinancier, rubrique)

  if (data.modePaiement === 'YELII') {
    if (!getConfigBool('MOBILE_MONEY_ENABLED', true)) {
      throw new AppError(
        'MOBILE_MONEY_DISABLED',
        'Le paiement Mobile Money est temporairement désactivé. Choisissez un autre mode de paiement.',
        403
      )
    }
    if (!data.mobileMoneyPhone || !data.paymentChannel) {
      throw new AppError(
        'VALIDATION',
        'Le numéro de téléphone et le réseau sont requis pour le paiement Mobile Money',
        400
      )
    }
  }

  if (data.modePaiement === 'ESPECES' && !getConfigBool('CASH_ENABLED', true)) {
    throw new AppError(
      'CASH_DISABLED',
      'Le paiement en espèces est temporairement désactivé. Choisissez un autre mode de paiement.',
      403
    )
  }

  if (data.modePaiement === 'CARTE_VISA') {
    if (!getConfigBool('CARD_ENABLED', true)) {
      throw new AppError(
        'CARD_DISABLED',
        'Le paiement par carte est temporairement désactivé. Choisissez un autre mode de paiement.',
        403
      )
    }
    if (!isCinetpayConfigured()) {
      throw new AppError(
        'CINETPAY_NOT_CONFIGURED',
        'Le paiement par carte est indisponible car CinetPay n’est pas configuré.',
        503
      )
    }
  }

  // Résoudre le vrai mode pour la traçabilité (MTN_MOMO / ORANGE_MONEY au lieu de YELII)
  type StoredMode = 'ESPECES' | 'MTN_MOMO' | 'ORANGE_MONEY' | 'CARTE_VISA' | 'YELII'
  let storedMode: StoredMode = data.modePaiement as StoredMode
  if (data.modePaiement === 'YELII') {
    storedMode = data.paymentChannel === 'ORANGE' ? 'ORANGE_MONEY' : 'MTN_MOMO'
  }

  const cardCustomerPhone = data.modePaiement === 'CARTE_VISA'
    ? data.customerPhone?.trim() || membre.user.phone?.trim() || membre.phone?.trim()
    : undefined

  const reservationKey = `${membreId}|${data.rubriqueId}|${storedMode}|${data.montant}`
  const reservation = await prisma.$transaction(async (tx) => {
    // pg_advisory_xact_lock renvoie void : utiliser executeRaw, pas queryRaw
    // (Prisma ne peut pas désérialiser une colonne PostgreSQL void).
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${reservationKey}, 0))
    `)

    const existing = await tx.contribution.findFirst({
      where: {
        membreId,
        rubriqueId: data.rubriqueId,
        montant: data.montant,
        modePaiement: storedMode,
        // Ne jamais réutiliser une contribution déjà confirmée par le parcours
        // rapide : son paymentStatus historique peut encore être PENDING.
        statut: 'EN_ATTENTE_CONFIRMATION',
        paymentStatus: { in: ['PENDING', 'PROCESSING'] },
      },
    })

    if (existing) {
      return { contribution: existing, created: false }
    }

    if (data.modePaiement === 'CARTE_VISA' && !cardCustomerPhone) {
      throw new AppError('VALIDATION', 'Un numéro de téléphone est requis pour le paiement par carte', 400)
    }

    let contribution = await tx.contribution.create({
      data: {
        membreId,
        rubriqueId: data.rubriqueId,
        montant: data.montant,
        montantAttendu: montantAttendu ?? data.montant,
        modePaiement: storedMode,
        // Self-service (MEMBRE) : aucun staff n'a traité ce paiement digital —
        // collecteurId reste null (déjà le cas pour les collectes publiques).
        collecteurId: isSelfService ? null : req.user!.userId,
        statut: 'EN_ATTENTE_CONFIRMATION',
        paymentStatus: 'PENDING',
        localisationFonds: data.modePaiement === 'ESPECES' ? 'CHEZ_COLLECTEUR' : 'EN_TRANSIT',
        mobileMoneyPhone: data.mobileMoneyPhone ?? null,
      },
    })

    if (data.modePaiement === 'CARTE_VISA') {
      const transactionId = `SGM${contribution.id.replace(/-/g, '').toUpperCase()}`
      contribution = await tx.contribution.update({
        where: { id: contribution.id },
        data: { externalTransactionId: transactionId, paymentStatus: 'PROCESSING' },
      })
    }

    return { contribution, created: true }
  })

  if (!reservation.created) {
    const existing = reservation.contribution
    const isCardReady = data.modePaiement === 'CARTE_VISA' && Boolean(existing.paymentUrl)
    const isMobileMoneyReady = data.modePaiement === 'YELII' && Boolean(existing.externalTransactionId)

    if (isCardReady || isMobileMoneyReady) {
      return res.json({
        success: true,
        data: {
          contributionId: existing.id,
          transactionId: existing.externalTransactionId,
          paymentUrl: existing.paymentUrl,
          status: existing.paymentStatus,
        },
      })
    }

    throw new AppError(
      'PAYMENT_INITIALIZATION_IN_PROGRESS',
      'L’initialisation de ce paiement est déjà en cours. Vérifiez son statut dans quelques instants.',
      409
    )
  }

  const contribution = reservation.contribution

  await audit({
    req, userId: req.user!.userId, userName: req.user!.email,
    action: 'CREATE', entityType: 'Contribution', entityId: contribution.id,
    details: { source: 'payment_initiate', montant: data.montant, modePaiement: storedMode },
  })

  // ── MODE MOBILE MONEY (Yelii) ─────────────────────────────────────────────
  if (data.modePaiement === 'YELII') {
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
      senderPhone: data.mobileMoneyPhone!,
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
      throw new AppError(
        'YELII_ERROR',
        'Le paiement Mobile Money n’a pas pu être initialisé. Veuillez réessayer.',
        502
      )
    }
  }

  // ── MODE ESPÈCES — confirmation directe par le collecteur ─────────────────
  if (data.modePaiement === 'ESPECES') {
    // RB-02 exception : espèces confirmées sans webhook car l'argent est physiquement présent
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: {
        statut: 'CONFIRME',
        confirmedAt: new Date(), // RB-01 : horodatage serveur
        paymentStatus: 'SUCCESS',
      },
    })
    const receiptUrl = await generateReceiptPDF(contribution.id)
    return res.json({
      success: true,
      data: { contributionId: contribution.id, status: 'SUCCESS', receiptUrl },
    })
  }

  // ── MODE CARTE BANCAIRE (CinetPay) ────────────────────────────────────────
  if (data.modePaiement === 'CARTE_VISA') {
    if (!cardCustomerPhone || !contribution.externalTransactionId) {
      throw new AppError('VALIDATION', 'Informations client incomplètes pour le paiement par carte', 400)
    }

    const txId = contribution.externalTransactionId

    try {
      const result = await initiateCinetpayPayment({
        transactionId: txId,
        amount: data.montant,
        description: `Contribution ${rubrique.code} — ${membre.user.lastName} ${membre.user.firstName}`.trim(),
        customerId: membre.id,
        customerName: membre.user.lastName,
        customerSurname: membre.user.firstName,
        customerPhone: cardCustomerPhone,
        customerEmail: membre.user.email,
        customerAddress: membre.adresse || 'EEC Melen',
        customerCity: 'Yaoundé',
        customerCountry: 'CM',
        customerState: 'CM',
        customerZipCode: '00000',
      })

      await prisma.contribution.update({
        where: { id: contribution.id },
        data: {
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
    } catch {
      throw new AppError(
        'CINETPAY_ERROR',
        'L’initialisation du paiement par carte est incertaine. La vérification du paiement continue automatiquement.',
        502
      )
    }
  }
})

/**
 * POST /api/payments/batches/initiate
 * Réserve atomiquement un paiement réparti entre plusieurs rubriques, puis
 * déclenche exactement un fournisseur pour le montant total du lot.
 */
router.post('/batches/initiate', authenticate, requireLevel(1), async (req, res) => {
  const data = initiateBatchSchema.parse(req.body)
  const isSelfService = req.user!.role === 'MEMBRE'

  if (isSelfService) {
    const membre = await prisma.membre.findFirst({
      where: { userId: req.user!.userId },
      select: { id: true },
    })
    if (!membre) throw new AppError('NOT_FOUND', 'Profil membre introuvable pour ce compte', 404)
    if (data.membreId !== membre.id) {
      throw new AppError('ACCESS_DENIED', 'Vous ne pouvez initier un paiement que pour vous-même', 403)
    }
  }

  // Les données client sont nécessaires à CinetPay, mais ne doivent être
  // récupérées qu'ici : le fournisseur ne sera appelé qu'une seule fois plus
  // bas, après la réservation idempotente du lot.
  const batchMember = data.modePaiement === 'CARTE_VISA'
    ? await prisma.membre.findUnique({
        where: { id: data.membreId },
        select: {
          id: true,
          phone: true,
          adresse: true,
          user: { select: { firstName: true, lastName: true, email: true, phone: true } },
        },
      })
    : null

  const cardCustomerPhone = data.modePaiement === 'CARTE_VISA'
    ? data.customerPhone?.trim() || batchMember?.user.phone?.trim() || batchMember?.phone?.trim()
    : undefined

  if (data.modePaiement === 'CARTE_VISA') {
    if (!batchMember) throw new AppError('NOT_FOUND', 'Membre introuvable', 404)
    if (!cardCustomerPhone) throw new AppError('VALIDATION', 'Un numéro de téléphone est requis pour le paiement par carte', 400)
    if (!isCinetpayConfigured()) {
      throw new AppError('CINETPAY_NOT_CONFIGURED', 'Le paiement par carte est indisponible car CinetPay n’est pas configuré.', 503)
    }
  }

  try {
    const result = await createPaymentBatch({
      ...data,
      collecteurId: data.collecteurId ?? (isSelfService ? undefined : req.user!.userId),
    })

    await audit({
      req,
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'CREATE',
      entityType: 'PaymentBatch',
      entityId: result.batchId,
      details: {
        source: 'payment_batch_initiate',
        membreId: result.membreId,
        budget: result.budget,
        totalAllocated: result.totalAllocated,
        modePaiement: result.modePaiement,
        created: result.created,
      },
    })

    // Une réservation existante porte déjà le résultat du fournisseur. Ne
    // jamais rejouer l'appel en cas de double soumission/idempotence.
    if (result.created) {
      const batchUpdate = async (dataToUpdate: Record<string, unknown>, childUpdate: Record<string, unknown>) => {
        await prisma.$transaction([
          (prisma as any).paymentBatch.update({ where: { id: result.batchId }, data: dataToUpdate }),
          (prisma.contribution as any).updateMany({ where: { paymentBatchId: result.batchId }, data: childUpdate }),
        ])
      }

      if (data.modePaiement === 'ESPECES') {
        // Les espèces restent une déclaration humaine : aucun fournisseur.
        // PENDING/EN_ATTENTE_CONFIRMATION est l'état attendu jusqu'à validation.
      } else if (data.modePaiement === 'YELII') {
        const payment = await initiateYeliiPayment({
          amount: result.totalToPay,
          senderPhone: data.mobileMoneyPhone!,
          channel: data.paymentChannel === 'ORANGE' ? 'orange_money' : 'mtn_money',
        })

        if (!payment.success || !payment.transactionId) {
          await batchUpdate({ status: 'FAILED' }, { paymentStatus: 'FAILED', statut: 'ANNULE' })
          throw new AppError('YELII_ERROR', 'Le paiement Mobile Money n’a pas pu être initialisé. Veuillez réessayer.', 502)
        }

        await batchUpdate(
          { externalTransactionId: payment.transactionId, status: 'PENDING' },
          { paymentStatus: 'PROCESSING', statut: 'EN_ATTENTE_CONFIRMATION' },
        )
        result.externalTransactionId = payment.transactionId
        result.status = 'PENDING'
        result.contributions = result.contributions.map(child => ({ ...child, paymentStatus: 'PROCESSING' }))
      } else {
        const transactionId = `SGMB${result.batchId.replace(/-/g, '').toUpperCase()}`
        try {
          const payment = await initiateCinetpayPayment({
            transactionId,
            amount: result.totalToPay,
            description: `Paiement groupé SGM CEM — ${batchMember!.user.lastName} ${batchMember!.user.firstName}`.trim(),
            customerId: batchMember!.id,
            customerName: batchMember!.user.lastName,
            customerSurname: batchMember!.user.firstName,
            customerPhone: cardCustomerPhone!,
            customerEmail: batchMember!.user.email,
            customerAddress: batchMember!.adresse || 'EEC Melen',
            customerCity: 'Yaoundé',
            customerCountry: 'CM',
            customerState: 'CM',
            customerZipCode: '00000',
          })

          await batchUpdate(
            { externalTransactionId: transactionId, paymentUrl: payment.paymentUrl, status: 'PENDING' },
            { paymentUrl: payment.paymentUrl, paymentStatus: 'PROCESSING', statut: 'EN_ATTENTE_CONFIRMATION' },
          )
          result.externalTransactionId = transactionId
          result.paymentUrl = payment.paymentUrl
          result.status = 'PENDING'
          result.contributions = result.contributions.map(child => ({ ...child, paymentStatus: 'PROCESSING' }))
        } catch {
          await batchUpdate({ status: 'FAILED' }, { paymentStatus: 'FAILED', statut: 'ANNULE' })
          throw new AppError('CINETPAY_ERROR', 'L’initialisation du paiement par carte est incertaine. La vérification du paiement continue automatiquement.', 502)
        }
      }
    }

    res.json({
      success: true,
      data: {
        ...result,
        dueAmount: result.totalAllocated,
      },
    })
  } catch (error) {
    if (error instanceof PaymentBatchError) {
      throw new AppError(error.code, error.message, error.statusCode)
    }
    throw error
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
      cardEnabled: getConfigBool('CARD_ENABLED', true) && isCinetpayConfigured(),
    },
  })
})

/**
 * GET /api/payments/status/:id
 * Polling du statut par ID de contribution (le frontend envoie contrib.id).
 * Accepte aussi externalTransactionId en fallback.
 * Repli direct sur Yelii avant de répondre : en dev local le webhook n'arrive
 * jamais, et le job de réconciliation n'agit qu'après 15 min, bien au-delà
 * des 5 min de polling du stepper — sans ce repli l'écran resterait figé.
 */
router.get('/status/:id', authenticate, requireLevel(1), async (req, res) => {
  const id = String(req.params.id)

  const contribution = await prisma.contribution.findFirst({
    where: {
      OR: [
        { id },
        { externalTransactionId: id },
      ],
    },
    select: CONTRIBUTION_SYNC_SELECT,
  })

  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)

  // MEMBRE : uniquement le suivi de son propre paiement.
  if (req.user!.role === 'MEMBRE') {
    const owner = await prisma.contribution.findUnique({ where: { id: contribution.id }, select: { membreId: true } })
    const membre = await prisma.membre.findFirst({ where: { userId: req.user!.userId }, select: { id: true } })
    if (!membre || owner?.membreId !== membre.id) {
      throw new AppError('INSUFFICIENT_PERMISSIONS', 'Vous ne pouvez consulter que vos propres paiements', 403)
    }
  }

  const synced = await syncYeliiContributionStatus(contribution)

  res.json({
    success: true,
    data: {
      id: synced.id,
      statut: synced.statut,
      paymentStatus: synced.paymentStatus,
      receiptUrl: synced.receiptUrl ?? null,
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
