import { getConfig, getConfigBool, getConfigNumber } from '../services/config.service'
import crypto from 'crypto'
import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { PrismaClient, type Prisma } from '@prisma/client'
import multer from 'multer'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { initiateYeliiPayment } from '../services/yelii.service'
import { generateReceiptPDF, generateReceiptPdf } from '../services/receipt'
import {
  deletePrivateStoredFile,
  getFileStream,
  getPrivateFileStream,
  storePrivateFile,
} from '../services/storage'
import { calculateAmountWithCommission, YELII_COMMISSION_RATE } from '@sgm-cem/shared'
import { notifyCollecteurNewContribution } from '../services/notification'
import { syncYeliiPaymentStatus } from '../services/payment-sync.service'
import { audit } from '../services/audit.service'
import { normalizePhone } from '../services/collecte.service'

// Modes réglés via Yelii Pro Pay (Mobile Money). "YELII" est l'option générique
// du formulaire rapide (opérateur non précisé) — on part sur MTN par défaut dans ce cas.
const YELII_MODES = ['MTN_MOMO', 'ORANGE_MONEY', 'YELII'] as const
function yeliiChannelFor(modePaiement: string, paymentChannel?: 'MTN' | 'ORANGE'): 'orange_money' | 'mtn_money' {
  if (modePaiement === 'ORANGE_MONEY') return 'orange_money'
  if (modePaiement === 'MTN_MOMO') return 'mtn_money'
  return paymentChannel === 'ORANGE' ? 'orange_money' : 'mtn_money'
}

const LOCALISATION_LABELS: Record<string, string> = {
  CHEZ_COLLECTEUR: 'Chez le collecteur',
  EN_TRANSIT: 'En transit',
  CHEZ_RESPONSABLE: 'Chez le responsable',
  REMIS_TRESORIER: 'Remis au trésorier',
  EN_CAISSE: 'En caisse',
  EN_BANQUE: 'En banque',
}

const router = Router()
const prisma = new PrismaClient()
const COLLECTION_ROLES = [
  'DEVELOPER',
  'ADMIN',
  'TRESORIER',
  'RESPONSABLE',
  'ADJOINT_RESPONSABLE',
  'COLLECTEUR',
] as const
const mobileMoneyPhoneSchema = z.string()
  .trim()
  .regex(
    /^(?:\+?237)?6\d{8}$/,
    'Le numéro Mobile Money doit être un numéro camerounais valide'
  )
  .transform(normalizePhone)

const createSchema = z.object({
  membreId: z.string(),
  rubriqueId: z.string(),
  collecteurId: z.string().optional(),
  montant: z.number().int().positive(),
  modePaiement: z.enum(['ESPECES', 'MTN_MOMO', 'ORANGE_MONEY', 'YELII', 'CARTE_VISA', 'VIREMENT']),
  periodeLabel: z.string().optional(),
  mobileMoneyPhone: mobileMoneyPhoneSchema.optional(),
  paymentChannel: z.enum(['MTN', 'ORANGE']).optional(),
  referencePaiement: z.string().optional(),
  // B1 — le collecteur encaisse en présentiel : confirmation immédiate, pas de double validation.
  directCollection: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if ((YELII_MODES as readonly string[]).includes(data.modePaiement) && !data.mobileMoneyPhone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Le numéro Mobile Money est requis pour ce moyen de paiement',
      path: ['mobileMoneyPhone'],
    })
  }
})

const declareSchema = z.object({
  collecteurId: z.string().min(1, 'Collecteur requis'),
  rubriqueId: z.string().min(1, 'Rubrique requise'),
  montant: z.number().int().positive('Le montant doit être un entier positif (FCFA)'),
  periodeLabel: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  statut: z.enum(['EN_ATTENTE_CONFIRMATION', 'CONFIRME', 'LITIGE', 'ANNULE']).optional(),
  modePaiement: z.enum(['ESPECES', 'MTN_MOMO', 'ORANGE_MONEY', 'YELII', 'CARTE_VISA', 'VIREMENT']).optional(),
  rubriqueId: z.string().min(1).optional(),
  membreId: z.string().min(1).optional(),
  search: z.string().trim().min(1).max(120).optional(),
})

const myContributionsQuerySchema = listQuerySchema.pick({
  page: true,
  limit: true,
  statut: true,
  modePaiement: true,
})

const routeIdSchema = z.object({
  id: z.string().min(1, 'Identifiant de contribution requis'),
})

const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype)) {
      cb(null, true)
      return
    }
    cb(new AppError('VALIDATION_ERROR', 'Format non supporté. Utilisez JPEG, PNG, WebP ou PDF.', 400))
  },
})

const proofUploadMiddleware: RequestHandler = (req, res, next) => {
  proofUpload.single('proof')(req, res, error => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new AppError('VALIDATION_ERROR', 'La preuve ne doit pas dépasser 10 Mo.', 400))
      return
    }
    next(error)
  })
}

function hasValidProofSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }
  if (mimeType === 'image/png') {
    return (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    )
  }
  if (mimeType === 'image/webp') {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    )
  }
  if (mimeType === 'application/pdf') {
    return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  }
  return false
}

type PrivateProofLocator = {
  key: string
  bucket?: string
  mode?: 'S3' | 'local'
}

function isPrivateProofKey(key: string, contributionId: string): boolean {
  const expectedPrefix = `contribution-proofs/${contributionId}/`
  const opaqueId = key.startsWith(expectedPrefix) ? key.slice(expectedPrefix.length) : ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(opaqueId)
}

function privateProofLocator(
  proofUrl: string | null,
  contributionId: string
): PrivateProofLocator | null {
  if (!proofUrl?.startsWith('private:')) return null

  if (!proofUrl.startsWith('private:v1:')) {
    const legacyKey = proofUrl.slice('private:'.length)
    return isPrivateProofKey(legacyKey, contributionId) ? { key: legacyKey } : null
  }

  try {
    const encoded = proofUrl.slice('private:v1:'.length)
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') return null

    const locator = parsed as Record<string, unknown>
    if (
      Object.keys(locator).sort().join(',') !== 'bucket,key,mode'
      || typeof locator.key !== 'string'
      || typeof locator.bucket !== 'string'
      || (locator.mode !== 'S3' && locator.mode !== 'local')
      || !locator.bucket
      || locator.bucket.length > 255
      || !isPrivateProofKey(locator.key, contributionId)
      || (locator.mode === 'local' && locator.bucket !== 'local')
    ) {
      return null
    }

    return {
      key: locator.key,
      bucket: locator.bucket,
      mode: locator.mode,
    }
  } catch {
    return null
  }
}

function encodePrivateProofLocator(locator: {
  key: string
  bucket: string
  mode: 'S3' | 'local'
}): string {
  const encoded = Buffer.from(JSON.stringify(locator), 'utf8').toString('base64url')
  return `private:v1:${encoded}`
}

function withProtectedProofUrl<T extends { id: string; proofUrl?: string | null }>(
  contribution: T
): T {
  if (!contribution.proofUrl) return contribution

  const apiUrl = getConfig('API_URL') ?? 'http://localhost:3001'
  return {
    ...contribution,
    proofUrl: `${apiUrl}/api/contributions/${encodeURIComponent(contribution.id)}/proof`,
  }
}

async function generateReceiptBestEffort(contributionId: string): Promise<void> {
  try {
    await generateReceiptPDF(contributionId)
  } catch (error) {
    console.error(`[Reçu] Génération impossible pour la contribution ${contributionId} :`, error)
  }
}

router.get('/me', authenticate, async (req, res) => {
  const query = myContributionsQuerySchema.parse(req.query)
  const membre = await prisma.membre.findUnique({
    where: { userId: req.user!.userId },
    select: { id: true },
  })
  if (!membre) throw new AppError('NOT_FOUND', 'Profil membre introuvable', 404)

  const where: Prisma.ContributionWhereInput = {
    membreId: membre.id,
    ...(query.statut ? { statut: query.statut } : {}),
    ...(query.modePaiement ? { modePaiement: query.modePaiement } : {}),
  }
  const skip = (query.page - 1) * query.limit

  const [contributions, total] = await Promise.all([
    prisma.contribution.findMany({
      where,
      skip,
      take: query.limit,
      select: {
        id: true,
        montant: true,
        montantAttendu: true,
        modePaiement: true,
        statut: true,
        localisationFonds: true,
        periodeLabel: true,
        referencePaiement: true,
        confirmedAt: true,
        receiptUrl: true,
        proofUrl: true,
        proofUploadedAt: true,
        createdAt: true,
        updatedAt: true,
        rubrique: { select: { title: true, code: true } },
        collecteur: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.contribution.count({ where }),
  ])

  res.json({
    success: true,
    data: contributions.map(withProtectedProofUrl),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  })
})

router.get('/', authenticate, requireLevel(2), async (req, res) => {
  const query = listQuerySchema.parse(req.query)
  const skip = (query.page - 1) * query.limit

  const where: Prisma.ContributionWhereInput = {
    ...(query.statut ? { statut: query.statut } : {}),
    ...(query.modePaiement ? { modePaiement: query.modePaiement } : {}),
    ...(query.rubriqueId ? { rubriqueId: query.rubriqueId } : {}),
    ...(query.membreId ? { membreId: query.membreId } : {}),
    ...(req.user!.role === 'COLLECTEUR' ? { collecteurId: req.user!.userId } : {}),
    ...(query.search ? {
      OR: [
        { membre: { user: { fullName: { contains: query.search, mode: 'insensitive' } } } },
        { contributeurExterne: { nom: { contains: query.search, mode: 'insensitive' } } },
        { rubrique: { title: { contains: query.search, mode: 'insensitive' } } },
        { rubrique: { code: { contains: query.search, mode: 'insensitive' } } },
        { collecteur: { fullName: { contains: query.search, mode: 'insensitive' } } },
        { referencePaiement: { contains: query.search, mode: 'insensitive' } },
      ],
    } : {}),
  }

  const [contributions, total] = await Promise.all([
    prisma.contribution.findMany({
      where,
      skip,
      take: query.limit,
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
    data: contributions.map(withProtectedProofUrl),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    }
  })
})

router.get('/validations', authenticate, requireLevel(2), async (req, res) => {
  const contributions = await prisma.contribution.findMany({
    where: {
      statut: 'EN_ATTENTE_CONFIRMATION',
      ...(req.user!.role === 'COLLECTEUR' ? { collecteurId: req.user!.userId } : {}),
    },
    include: {
      membre: { include: { user: { select: { fullName: true } } } },
      rubrique: { select: { title: true, code: true } },
      collecteur: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })

  res.json({ success: true, data: contributions.map(withProtectedProofUrl) })
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

  res.json({ success: true, data: contributions.map(withProtectedProofUrl) })
})

router.post('/', authenticate, requireLevel(2), async (req, res) => {
  const data = createSchema.parse(req.body)
  const isYeliiMode = (YELII_MODES as readonly string[]).includes(data.modePaiement)
  if (isYeliiMode && !getConfigBool('MOBILE_MONEY_ENABLED', true)) {
    throw new AppError(
      'DISABLED',
      'Le paiement Mobile Money est temporairement désactivé',
      403
    )
  }

  const {
    directCollection,
    paymentChannel,
    collecteurId: requestedCollecteurId,
    ...contributionData
  } = data
  const collecteurId =
    req.user!.role === 'COLLECTEUR'
      ? req.user!.userId
      : requestedCollecteurId ?? req.user!.userId

  const [rubrique, membre, collecteur] = await Promise.all([
    prisma.rubrique.findUnique({ where: { id: data.rubriqueId } }),
    prisma.membre.findUnique({ where: { id: data.membreId } }),
    prisma.user.findFirst({
      where: {
        id: collecteurId,
        isActive: true,
        role: { in: [...COLLECTION_ROLES] },
      },
      select: { id: true },
    }),
  ])

  if (!rubrique || rubrique.status !== 'OUVERTE') {
    throw new AppError('BUSINESS_RULE', 'Rubrique fermee ou introuvable')
  }
  if (!membre || !membre.isActive) {
    throw new AppError('NOT_FOUND', 'Membre introuvable ou inactif', 404)
  }
  if (!collecteur) {
    throw new AppError('NOT_FOUND', 'Collecteur introuvable ou rôle non éligible', 404)
  }

  const montantAttendu =
    membre.profilFinancier === 'ETUDIANT' ? rubrique.amountEtudiant :
    membre.profilFinancier === 'COUPLE' ? rubrique.amountCouple :
    rubrique.amountTravailleur

  // B1 — encaissement en présentiel : confirmation immédiate, sans double validation.
  const isDirectCash =
    data.modePaiement === 'ESPECES'
    && directCollection === true
    && collecteurId === req.user!.userId

  const contribution = await prisma.contribution.create({
    data: {
      ...contributionData,
      collecteurId,
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

  await audit({
    req,
    userId: req.user!.userId,
    userName: req.user!.email,
    action: 'CREATE',
    entityType: 'Contribution',
    entityId: contribution.id,
    details: { montant: contribution.montant, statut: contribution.statut },
  })

  if (isDirectCash) {
    await generateReceiptBestEffort(contribution.id)
  }

  let finalContribution = contribution
  if (isYeliiMode && data.mobileMoneyPhone) {
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

    const refreshed = await prisma.contribution.findUnique({
      where: { id: contribution.id },
      include: {
        membre: { include: { user: { select: { fullName: true } } } },
        rubrique: { select: { title: true, code: true } },
        collecteur: { select: { fullName: true } },
      },
    })
    if (!refreshed) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
    finalContribution = refreshed

    await audit({
      req,
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'UPDATE',
      entityType: 'Contribution',
      entityId: refreshed.id,
      details: {
        statut: refreshed.statut,
        paymentStatus: refreshed.paymentStatus,
        modePaiement: refreshed.modePaiement,
      },
    })
  }

  res.status(201).json({ success: true, data: withProtectedProofUrl(finalContribution) })
})

router.post('/declare', authenticate, requireLevel(2), async (req, res) => {
  const data = declareSchema.parse(req.body)
  const collecteurId =
    req.user!.role === 'COLLECTEUR' ? req.user!.userId : data.collecteurId

  const [rubrique, collecteur] = await Promise.all([
    prisma.rubrique.findUnique({ where: { id: data.rubriqueId } }),
    prisma.user.findFirst({
      where: { id: collecteurId, isActive: true, role: { in: ['TRESORIER', 'COLLECTEUR'] } },
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
      collecteurId,
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

  await audit({
    req,
    userId: req.user!.userId,
    userName: req.user!.email,
    action: 'CREATE',
    entityType: 'Contribution',
    entityId: contribution.id,
    details: {
      montant: contribution.montant,
      statut: contribution.statut,
      declaredForCollecteurId: collecteurId,
      viaDeclare: true,
    },
  })

  try {
    await notifyCollecteurNewContribution({
      collecteurId,
      collecteurPhone: collecteur.whatsappPhone ?? collecteur.phone,
      memberName: `Remise groupée déclarée par ${req.user!.email}`,
      montant: contribution.montant,
      rubriqueCode: contribution.rubrique.code,
    })
  } catch (e) {
    console.error('[Notification] Échec notification collecteur (declare):', e)
  }

  res.status(201).json({ success: true, data: withProtectedProofUrl(contribution) })
})

router.get('/:id/timeline', authenticate, requireLevel(2), async (req, res) => {
  const { id } = routeIdSchema.parse(req.params)
  const contribution = await prisma.contribution.findUnique({
    where: { id },
    include: {
      membre: { include: { user: { select: { fullName: true } } } },
      contributeurExterne: { select: { nom: true } },
      rubrique: { select: { title: true, code: true } },
      collecteur: { select: { fullName: true } },
      fundsTransfer: {
        select: {
          createdAt: true,
          confirmedAt: true,
          refusedAt: true,
          cancelledAt: true,
          senderName: true,
          receiverName: true,
          status: true,
        },
      },
      bankDeposit: {
        select: {
          referenceBordereau: true,
          depositedByName: true,
          createdAt: true,
        },
      },
    },
  })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  if (req.user!.role === 'COLLECTEUR' && contribution.collecteurId !== req.user!.userId) {
    throw new AppError('ACCESS_DENIED', 'Vous ne pouvez consulter que vos propres contributions', 403)
  }

  const confirmedBy = contribution.confirmedById
    ? await prisma.user.findUnique({
        where: { id: contribution.confirmedById },
        select: { fullName: true },
      })
    : null
  const contributorName =
    contribution.membre?.user.fullName ??
    contribution.contributeurExterne?.nom ??
    'Contributeur'
  const collectorName = contribution.collecteur?.fullName ?? 'Système'

  const timeline: Array<{
    step: string
    label: string
    actor: string
    at: Date
    localisation?: string
    detail?: string
  }> = [{
    step: 'CREATION',
    label: 'Contribution enregistrée',
    actor: collectorName,
    at: contribution.createdAt,
    localisation: LOCALISATION_LABELS[contribution.localisationFonds],
  }]

  if (contribution.proofUploadedAt) {
    timeline.push({
      step: 'PREUVE',
      label: 'Preuve de paiement ajoutée',
      actor: 'Utilisateur autorisé',
      at: contribution.proofUploadedAt,
    })
  }

  if (contribution.fundsTransfer) {
    timeline.push({
      step: 'TRANSFERT',
      label: 'Transfert de fonds initié',
      actor: contribution.fundsTransfer.senderName,
      at: contribution.fundsTransfer.createdAt,
      localisation: `Vers ${contribution.fundsTransfer.receiverName}`,
    })

    if (contribution.fundsTransfer.confirmedAt) {
      timeline.push({
        step: 'TRANSFERT_CONFIRME',
        label: 'Transfert de fonds confirmé',
        actor: contribution.fundsTransfer.receiverName,
        at: contribution.fundsTransfer.confirmedAt,
      })
    } else if (contribution.fundsTransfer.refusedAt) {
      timeline.push({
        step: 'TRANSFERT_REFUSE',
        label: 'Transfert de fonds refusé',
        actor: contribution.fundsTransfer.receiverName,
        at: contribution.fundsTransfer.refusedAt,
      })
    } else if (contribution.fundsTransfer.cancelledAt) {
      timeline.push({
        step: 'TRANSFERT_ANNULE',
        label: 'Transfert de fonds annulé',
        actor: contribution.fundsTransfer.senderName,
        at: contribution.fundsTransfer.cancelledAt,
      })
    }
  }

  if (contribution.bankDeposit) {
    timeline.push({
      step: 'DEPOT_BANCAIRE',
      label: 'Fonds déposés en banque',
      actor: contribution.bankDeposit.depositedByName,
      at: contribution.bankDeposit.createdAt,
      localisation: LOCALISATION_LABELS.EN_BANQUE,
      detail: `Bordereau ${contribution.bankDeposit.referenceBordereau}`,
    })
  }

  if (contribution.confirmedAt) {
    timeline.push({
      step: 'CONFIRMATION',
      label: 'Contribution confirmée',
      actor: confirmedBy?.fullName ?? 'Système',
      at: contribution.confirmedAt,
      localisation: LOCALISATION_LABELS[contribution.localisationFonds],
    })
  } else if (contribution.statut === 'LITIGE') {
    timeline.push({
      step: 'LITIGE',
      label: 'Contribution placée en litige',
      actor: 'Gestionnaire',
      at: contribution.updatedAt,
      detail: contribution.litigeMotif ?? undefined,
    })
  } else if (contribution.statut === 'ANNULE') {
    timeline.push({
      step: 'ANNULATION',
      label: 'Contribution annulée',
      actor: 'Gestionnaire',
      at: contribution.updatedAt,
    })
  }

  timeline.sort((left, right) => right.at.getTime() - left.at.getTime())

  res.json({
    success: true,
    data: {
      contribution: {
        id: contribution.id,
        membre: contributorName,
        rubrique: `${contribution.rubrique.code} — ${contribution.rubrique.title}`,
        montant: contribution.montant,
        statut: contribution.statut,
      },
      timeline,
    },
  })
})

router.post(
  '/:id/proof',
  authenticate,
  requireLevel(2),
  proofUploadMiddleware,
  async (req, res) => {
    const { id } = routeIdSchema.parse(req.params)
    if (!req.file) throw new AppError('VALIDATION_ERROR', 'Aucune preuve fournie', 400)
    if (!hasValidProofSignature(req.file.buffer, req.file.mimetype)) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Le contenu du fichier ne correspond pas au format annoncé.',
        400
      )
    }

    const contribution = await prisma.contribution.findUnique({ where: { id } })
    if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
    if (req.user!.role === 'COLLECTEUR' && contribution.collecteurId !== req.user!.userId) {
      throw new AppError('ACCESS_DENIED', 'Vous ne pouvez modifier que vos propres contributions', 403)
    }
    if (contribution.statut !== 'EN_ATTENTE_CONFIRMATION') {
      throw new AppError(
        'BUSINESS_RULE',
        'Une preuve peut être ajoutée uniquement à une contribution en attente',
        400
      )
    }

    const previousLocator = privateProofLocator(contribution.proofUrl, id)
    const key = `contribution-proofs/${id}/${crypto.randomUUID()}`
    // Le bucket configuré pour ces objets doit interdire toute lecture publique.
    const stored = await storePrivateFile(key, req.file.buffer, req.file.mimetype)
    const proofUploadedAt = new Date()

    const updateResult = await prisma.contribution.updateMany({
      where: {
        id,
        statut: 'EN_ATTENTE_CONFIRMATION',
        ...(req.user!.role === 'COLLECTEUR' ? { collecteurId: req.user!.userId } : {}),
      },
      data: {
        proofUrl: encodePrivateProofLocator(stored),
        proofUploadedAt,
      },
    })

    if (updateResult.count === 0) {
      await deletePrivateStoredFile(key, stored.bucket).catch(() => undefined)
      throw new AppError(
        'BUSINESS_RULE',
        'La contribution a changé d’état avant l’ajout de la preuve',
        400
      )
    }

    if (previousLocator) {
      await deletePrivateStoredFile(previousLocator.key, previousLocator.bucket)
        .catch(() => undefined)
    }

    const updated = await prisma.contribution.findUnique({
      where: { id },
      include: {
        membre: { include: { user: { select: { fullName: true } } } },
        rubrique: { select: { title: true, code: true } },
        collecteur: { select: { fullName: true } },
      },
    })
    if (!updated) {
      throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
    }

    await audit({
      req,
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'UPDATE',
      entityType: 'Contribution',
      entityId: id,
      details: {
        action: 'proof_upload',
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        storageMode: stored.mode,
      },
    })

    res.json({ success: true, data: withProtectedProofUrl(updated) })
  }
)

router.get('/:id/proof', authenticate, requireLevel(2), async (req, res, next) => {
  const { id } = routeIdSchema.parse(req.params)
  const contribution = await prisma.contribution.findUnique({
    where: { id },
    select: { collecteurId: true, proofUrl: true, proofUploadedAt: true },
  })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  if (req.user!.role === 'COLLECTEUR' && contribution.collecteurId !== req.user!.userId) {
    throw new AppError('ACCESS_DENIED', 'Vous ne pouvez consulter que vos propres contributions', 403)
  }
  if (!contribution.proofUploadedAt) {
    throw new AppError('NOT_FOUND', 'Preuve de paiement introuvable', 404)
  }

  const locator = privateProofLocator(contribution.proofUrl, id)
  if (!locator) throw new AppError('NOT_FOUND', 'Preuve de paiement introuvable', 404)

  const file = await getPrivateFileStream(locator.key, locator.bucket)
  if (!file) throw new AppError('NOT_FOUND', 'Preuve de paiement introuvable', 404)

  const safeContentTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  const contentType =
    file.contentType && safeContentTypes.has(file.contentType)
      ? file.contentType
      : 'application/octet-stream'

  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Disposition', 'inline; filename="preuve-contribution"')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  file.stream.on('error', next).pipe(res)
})

router.get('/:id/payment-status', authenticate, requireLevel(2), async (req, res) => {
  const { id } = routeIdSchema.parse(req.params)
  const contribution = await prisma.contribution.findUnique({
    where: { id },
    select: { collecteurId: true },
  })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  if (req.user!.role === 'COLLECTEUR' && contribution.collecteurId !== req.user!.userId) {
    throw new AppError('ACCESS_DENIED', 'Vous ne pouvez consulter que vos propres contributions', 403)
  }

  const result = await syncYeliiPaymentStatus(id)
  if (!result) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  res.json({ success: true, data: { id: result.id, statut: result.statut } })
})

router.patch('/:id/confirm', authenticate, requireLevel(2), async (req, res) => {
  const { id } = routeIdSchema.parse(req.params)
  const contribution = await prisma.contribution.findUnique({ where: { id } })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  if (req.user!.role === 'COLLECTEUR' && contribution.collecteurId !== req.user!.userId) {
    throw new AppError('ACCESS_DENIED', 'Vous ne pouvez valider que vos propres contributions', 403)
  }
  if (contribution.statut !== 'EN_ATTENTE_CONFIRMATION') {
    throw new AppError('BUSINESS_RULE', 'Cette contribution ne peut pas être confirmée')
  }

  const updateResult = await prisma.contribution.updateMany({
    where: {
      id,
      statut: 'EN_ATTENTE_CONFIRMATION',
      ...(req.user!.role === 'COLLECTEUR' ? { collecteurId: req.user!.userId } : {}),
    },
    data: { statut: 'CONFIRME', confirmedAt: new Date(), confirmedById: req.user!.userId }
  })
  if (updateResult.count === 0) {
    throw new AppError('BUSINESS_RULE', 'Cette contribution ne peut plus être confirmée')
  }

  const updated = await prisma.contribution.findUnique({ where: { id } })
  if (!updated) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)

  await audit({
    req,
    userId: req.user!.userId,
    userName: req.user!.email,
    action: 'CONFIRM',
    entityType: 'Contribution',
    entityId: updated.id,
    details: { montant: updated.montant },
  })

  await generateReceiptBestEffort(updated.id)

  res.json({ success: true, data: withProtectedProofUrl(updated) })
})

router.patch('/:id/litige', authenticate, requireLevel(2), async (req, res) => {
  const { id } = routeIdSchema.parse(req.params)
  const { motif } = z.object({ motif: z.string().min(10) }).parse(req.body)

  const contribution = await prisma.contribution.findUnique({ where: { id } })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  if (req.user!.role === 'COLLECTEUR' && contribution.collecteurId !== req.user!.userId) {
    throw new AppError('ACCESS_DENIED', 'Vous ne pouvez contester que vos propres contributions', 403)
  }
  if (contribution.statut !== 'EN_ATTENTE_CONFIRMATION') {
    throw new AppError('BUSINESS_RULE', 'Cette contribution ne peut pas être placée en litige')
  }

  const updateResult = await prisma.contribution.updateMany({
    where: {
      id,
      statut: 'EN_ATTENTE_CONFIRMATION',
      ...(req.user!.role === 'COLLECTEUR' ? { collecteurId: req.user!.userId } : {}),
    },
    data: { statut: 'LITIGE', litigeMotif: motif }
  })
  if (updateResult.count === 0) {
    throw new AppError('BUSINESS_RULE', 'Cette contribution ne peut plus être placée en litige')
  }

  const updated = await prisma.contribution.findUnique({ where: { id } })
  if (!updated) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)

  await audit({
    req,
    userId: req.user!.userId,
    userName: req.user!.email,
    action: 'REJECT',
    entityType: 'Contribution',
    entityId: updated.id,
    details: { motif },
  })

  res.json({ success: true, data: withProtectedProofUrl(updated) })
})

router.patch('/:id/resolve-litige', authenticate, requireLevel(3), async (req, res) => {
  const { resolution, note } = z.object({
    resolution: z.enum(['CONFIRME', 'ANNULE']),
    note: z.string().max(500).optional(),
  }).parse(req.body)

  const { id } = routeIdSchema.parse(req.params)
  const contribution = await prisma.contribution.findUnique({ where: { id } })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  if (contribution.statut !== 'LITIGE') {
    throw new AppError('BUSINESS_RULE', 'Cette contribution n’est pas en litige')
  }

  const updateResult = await prisma.contribution.updateMany({
    where: { id, statut: 'LITIGE' },
    data: {
      statut: resolution,
      confirmedAt: resolution === 'CONFIRME' ? new Date() : contribution.confirmedAt,
      confirmedById: resolution === 'CONFIRME' ? req.user!.userId : contribution.confirmedById,
      litigeMotif: note ? `${contribution.litigeMotif ?? ''}\nRésolution : ${note}` : contribution.litigeMotif,
    }
  })
  if (updateResult.count === 0) {
    throw new AppError('BUSINESS_RULE', 'Ce litige a déjà été résolu')
  }

  const updated = await prisma.contribution.findUnique({ where: { id } })
  if (!updated) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)

  await audit({
    req,
    userId: req.user!.userId,
    userName: req.user!.email,
    action: resolution === 'CONFIRME' ? 'APPROVE' : 'REJECT',
    entityType: 'ContributionLitige',
    entityId: updated.id,
    details: { resolution, note },
  })

  if (resolution === 'CONFIRME') {
    await generateReceiptBestEffort(updated.id)
  }

  res.json({ success: true, data: withProtectedProofUrl(updated) })
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
  if (req.user!.role === 'COLLECTEUR' && contribution.collecteurId !== req.user!.userId) {
    throw new AppError('ACCESS_DENIED', 'Vous ne pouvez consulter que vos propres contributions', 403)
  }
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
    await generateReceiptBestEffort(id) // persiste receiptUrl pour les prochains appels
  }

  const filename = `Recu-CEM-${id.substring(0, 8).toUpperCase()}.pdf`
  const disposition = req.query.download === '1' ? 'attachment' : 'inline'
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`)
  res.send(pdfBuffer)
})

export { router as contributionsRouter }
