import { getConfig, getConfigBool, getConfigNumber } from '../services/config.service'
import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { initiateYeliiPayment } from '../services/yelii.service'
import { generateReceiptPDF, generateReceiptPdf } from '../services/receipt'
import { getFileStream } from '../services/storage'
import { calculateAmountWithCommission, YELII_COMMISSION_RATE } from '@sgm-cem/shared'
import { notifyCollecteurNewContribution } from '../services/notification'
import { syncYeliiPaymentStatus } from '../services/payment-sync.service'

// Modes réglés via Yelii Pro Pay (Mobile Money). "YELII" est l'option générique
// du formulaire rapide (opérateur non précisé) — on part sur MTN par défaut dans ce cas.
const YELII_MODES = ['MTN_MOMO', 'ORANGE_MONEY', 'YELII'] as const
function yeliiChannelFor(modePaiement: string, paymentChannel?: 'MTN' | 'ORANGE'): 'orange_money' | 'mtn_money' {
  if (modePaiement === 'ORANGE_MONEY') return 'orange_money'
  if (modePaiement === 'MTN_MOMO') return 'mtn_money'
  return paymentChannel === 'ORANGE' ? 'orange_money' : 'mtn_money'
}

const router = Router()
const prisma = new PrismaClient()

const createSchema = z.object({
  membreId: z.string(),
  rubriqueId: z.string(),
  collecteurId: z.string().optional(),
  montant: z.number().int().positive(),
  modePaiement: z.enum(['ESPECES', 'MTN_MOMO', 'ORANGE_MONEY', 'YELII', 'CARTE_VISA', 'VIREMENT']),
  periodeLabel: z.string().optional(),
  mobileMoneyPhone: z.string().optional(),
  paymentChannel: z.enum(['MTN', 'ORANGE']).optional(),
  referencePaiement: z.string().optional(),
  // B1 — le collecteur encaisse en présentiel : confirmation immédiate, pas de double validation.
  directCollection: z.boolean().optional(),
})

const declareSchema = z.object({
  collecteurId: z.string().min(1, 'Collecteur requis'),
  rubriqueId: z.string().min(1, 'Rubrique requise'),
  montant: z.number().int().positive('Le montant doit être un entier positif (FCFA)'),
  periodeLabel: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
})

router.get('/', authenticate, requireLevel(2), async (req, res) => {
  const { page = '1', limit = '20', statut, rubriqueId, membreId } = req.query as Record<string, string>
  const currentPage = Math.max(1, parseInt(page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
  const skip = (currentPage - 1) * pageSize

  const where = {
    ...(statut && { statut: statut as never }),
    ...(rubriqueId && { rubriqueId }),
    ...(membreId && { membreId }),
  }

  const [contributions, total] = await Promise.all([
    prisma.contribution.findMany({
      where,
      skip,
      take: pageSize,
      include: {
        membre: { include: { user: { select: { fullName: true } } } },
        rubrique: { select: { title: true, code: true } },
        collecteur: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.contribution.count({ where })
  ])

  res.json({
    success: true,
    data: contributions,
    pagination: { page: currentPage, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) }
  })
})

router.get('/validations', authenticate, requireLevel(2), async (_req, res) => {
  const contributions = await prisma.contribution.findMany({
    where: { statut: 'EN_ATTENTE_CONFIRMATION' },
    include: {
      membre: { include: { user: { select: { fullName: true } } } },
      rubrique: { select: { title: true, code: true } },
      collecteur: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })

  res.json({ success: true, data: contributions })
})

router.get('/litiges', authenticate, requireLevel(3), async (_req, res) => {
  const contributions = await prisma.contribution.findMany({
    where: { statut: 'LITIGE' },
    include: {
      membre: { include: { user: { select: { fullName: true } } } },
      rubrique: { select: { title: true, code: true } },
      collecteur: { select: { fullName: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  })

  res.json({ success: true, data: contributions })
})

router.post('/', authenticate, requireLevel(2), async (req, res) => {
  const data = createSchema.parse(req.body)
  const { directCollection, paymentChannel, ...contributionData } = data

  const [rubrique, membre] = await Promise.all([
    prisma.rubrique.findUnique({ where: { id: data.rubriqueId } }),
    prisma.membre.findUnique({ where: { id: data.membreId } }),
  ])

  if (!rubrique || rubrique.status !== 'OUVERTE') {
    throw new AppError('BUSINESS_RULE', 'Rubrique fermee ou introuvable')
  }
  if (!membre || !membre.isActive) {
    throw new AppError('NOT_FOUND', 'Membre introuvable ou inactif', 404)
  }

  const montantAttendu =
    membre.profilFinancier === 'ETUDIANT' ? rubrique.amountEtudiant :
    membre.profilFinancier === 'COUPLE' ? rubrique.amountCouple :
    rubrique.amountTravailleur

  // B1 — encaissement en présentiel : confirmation immédiate, sans double validation.
  const isDirectCash = data.modePaiement === 'ESPECES' && directCollection === true

  const contribution = await prisma.contribution.create({
    data: {
      ...contributionData,
      collecteurId: data.collecteurId ?? req.user!.userId,
      montantAttendu: montantAttendu ?? data.montant,
      statut: isDirectCash ? 'CONFIRME' : 'EN_ATTENTE_CONFIRMATION',
      localisationFonds: data.modePaiement === 'ESPECES' ? 'CHEZ_COLLECTEUR' : 'EN_TRANSIT',
      confirmedAt: isDirectCash ? new Date() : undefined,
      confirmedById: isDirectCash ? req.user!.userId : undefined,
    },
    include: {
      membre: { include: { user: { select: { fullName: true } } } },
      rubrique: { select: { title: true, code: true } },
      collecteur: { select: { fullName: true } },
    }
  })

  if (isDirectCash) {
    await generateReceiptPDF(contribution.id)
  }

  if ((YELII_MODES as readonly string[]).includes(data.modePaiement) && data.mobileMoneyPhone) {
    // Interrupteur section E du panneau développeur
    if (!getConfigBool('MOBILE_MONEY_ENABLED', true)) {
      return res.status(403).json({ success: false, error: { code: 'DISABLED', message: 'Le paiement Mobile Money est temporairement désactivé' } })
    }
    // §1bis — Le contributeur supporte la commission Yelii de 2,5 %.
    // On envoie à Yelii le montant MAJORÉ (totalToPay), jamais le montant dû brut.
    // Taux effectif lu en base à CHAQUE appel (panneau développeur, section C).
    const { totalToPay, commissionAmount } = calculateAmountWithCommission(
      contribution.montant,
      getConfigNumber('YELII_COMMISSION_RATE', YELII_COMMISSION_RATE)
    )
    const channel = yeliiChannelFor(data.modePaiement, data.paymentChannel)

    const payment = await initiateYeliiPayment({
      amount: totalToPay, // ← montant majoré, PAS contribution.montant
      senderPhone: data.mobileMoneyPhone,
      channel,
    })

    if (payment.success && payment.transactionId) {
      await prisma.contribution.update({
        where: { id: contribution.id },
        data: {
          externalTransactionId: payment.transactionId,
          paymentStatus: 'PROCESSING',
          modePaiement: channel === 'orange_money' ? 'ORANGE_MONEY' : 'MTN_MOMO',
          amountChargedToPayer: totalToPay,
          commissionPaidByPayer: commissionAmount,
        },
      })
    } else {
      await prisma.contribution.update({
        where: { id: contribution.id },
        data: { statut: 'ANNULE', paymentStatus: 'FAILED', litigeMotif: payment.message ?? 'Échec de la collecte Yelii' },
      })
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'CREATE',
      entityType: 'Contribution',
      entityId: contribution.id,
      details: { montant: contribution.montant, statut: contribution.statut },
    }
  })

  res.status(201).json({ success: true, data: contribution })
})

router.post('/declare', authenticate, requireLevel(2), async (req, res) => {
  const data = declareSchema.parse(req.body)

  const [rubrique, collecteur] = await Promise.all([
    prisma.rubrique.findUnique({ where: { id: data.rubriqueId } }),
    prisma.user.findFirst({
      where: { id: data.collecteurId, isActive: true, role: { in: ['TRESORIER', 'COLLECTEUR'] } },
      select: { id: true, fullName: true, phone: true, whatsappPhone: true },
    }),
  ])

  if (!rubrique || rubrique.status !== 'OUVERTE') {
    throw new AppError('BUSINESS_RULE', 'Rubrique fermée ou introuvable')
  }
  if (!collecteur) {
    throw new AppError('NOT_FOUND', 'Collecteur introuvable ou rôle non éligible', 404)
  }

  const contribution = await prisma.contribution.create({
    data: {
      rubriqueId: data.rubriqueId,
      collecteurId: data.collecteurId,
      montant: data.montant,
      montantAttendu: data.montant,
      modePaiement: 'ESPECES',
      statut: 'EN_ATTENTE_CONFIRMATION',
      localisationFonds: 'CHEZ_COLLECTEUR',
      periodeLabel: data.periodeLabel,
      note: data.note,
    },
    include: {
      rubrique: { select: { title: true, code: true } },
      collecteur: { select: { fullName: true } },
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'CREATE',
      entityType: 'Contribution',
      entityId: contribution.id,
      details: { montant: contribution.montant, statut: contribution.statut, declaredForCollecteurId: data.collecteurId, viaDeclare: true },
    },
  })

  try {
    await notifyCollecteurNewContribution({
      collecteurId: data.collecteurId,
      collecteurPhone: collecteur.whatsappPhone ?? collecteur.phone,
      memberName: `Remise groupée déclarée par ${req.user!.email}`,
      montant: contribution.montant,
      rubriqueCode: contribution.rubrique.code,
    })
  } catch (e) {
    console.error('[Notification] Échec notification collecteur (declare):', e)
  }

  res.status(201).json({ success: true, data: contribution })
})

router.get('/:id/payment-status', authenticate, requireLevel(2), async (req, res) => {
  const result = await syncYeliiPaymentStatus(String(req.params.id))
  if (!result) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  res.json({ success: true, data: { id: result.id, statut: result.statut } })
})

router.patch('/:id/confirm', authenticate, requireLevel(2), async (req, res) => {
  const id = String(req.params.id)
  const contribution = await prisma.contribution.findUnique({ where: { id } })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  if (contribution.statut !== 'EN_ATTENTE_CONFIRMATION') {
    throw new AppError('BUSINESS_RULE', 'Cette contribution ne peut pas etre confirmee')
  }

  const updated = await prisma.contribution.update({
    where: { id },
    data: { statut: 'CONFIRME', confirmedAt: new Date(), confirmedById: req.user!.userId }
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'CONFIRM',
      entityType: 'Contribution',
      entityId: updated.id,
      details: { montant: updated.montant },
    }
  })

  await generateReceiptPDF(updated.id)

  res.json({ success: true, data: updated })
})

router.patch('/:id/litige', authenticate, requireLevel(2), async (req, res) => {
  const { motif } = z.object({ motif: z.string().min(10) }).parse(req.body)
  const updated = await prisma.contribution.update({
    where: { id: String(req.params.id) },
    data: { statut: 'LITIGE', litigeMotif: motif }
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'REJECT',
      entityType: 'Contribution',
      entityId: updated.id,
      details: { motif },
    }
  })

  res.json({ success: true, data: updated })
})

router.patch('/:id/resolve-litige', authenticate, requireLevel(3), async (req, res) => {
  const { resolution, note } = z.object({
    resolution: z.enum(['CONFIRME', 'ANNULE']),
    note: z.string().max(500).optional(),
  }).parse(req.body)

  const id = String(req.params.id)
  const contribution = await prisma.contribution.findUnique({ where: { id } })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  if (contribution.statut !== 'LITIGE') throw new AppError('BUSINESS_RULE', 'Cette contribution n est pas en litige')

  const updated = await prisma.contribution.update({
    where: { id },
    data: {
      statut: resolution,
      confirmedAt: resolution === 'CONFIRME' ? new Date() : contribution.confirmedAt,
      confirmedById: resolution === 'CONFIRME' ? req.user!.userId : contribution.confirmedById,
      litigeMotif: note ? `${contribution.litigeMotif ?? ''}\nResolution: ${note}` : contribution.litigeMotif,
    }
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: resolution === 'CONFIRME' ? 'APPROVE' : 'REJECT',
      entityType: 'ContributionLitige',
      entityId: updated.id,
      details: { resolution, note },
    }
  })

  if (resolution === 'CONFIRME') {
    await generateReceiptPDF(updated.id)
  }

  res.json({ success: true, data: updated })
})

/**
 * GET /api/contributions/:id/receipt
 * Reçu PDF — vue inline par défaut (?download=1 force le téléchargement).
 * Réutilise le PDF déjà généré s'il existe (webhook/confirmation), sinon le
 * génère à la volée (auto-guérison pour les contributions confirmées avant
 * la mise en place de la génération automatique).
 */
router.get('/:id/receipt', authenticate, requireLevel(2), async (req, res) => {
  const id = String(req.params.id)
  const contribution = await prisma.contribution.findUnique({ where: { id } })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  if (contribution.statut !== 'CONFIRME') {
    throw new AppError('BUSINESS_RULE', 'Le reçu est disponible uniquement pour les contributions confirmées', 400)
  }

  let pdfBuffer: Buffer | null = null
  const apiUrl = getConfig('API_URL') ?? 'http://localhost:3001'

  if (contribution.receiptUrl?.startsWith(`${apiUrl}/uploads/`)) {
    const key = contribution.receiptUrl.replace(`${apiUrl}/uploads/`, '')
    const file = await getFileStream(key)
    if (file) {
      const chunks: Buffer[] = []
      for await (const chunk of file.stream) chunks.push(chunk as Buffer)
      pdfBuffer = Buffer.concat(chunks)
    }
  }

  if (!pdfBuffer) {
    pdfBuffer = await generateReceiptPdf(id)
    await generateReceiptPDF(id) // persiste receiptUrl pour les prochains appels
  }

  const filename = `Recu-CEM-${id.substring(0, 8).toUpperCase()}.pdf`
  const disposition = req.query.download === '1' ? 'attachment' : 'inline'
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`)
  res.send(pdfBuffer)
})

export { router as contributionsRouter }
