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
import { calculateAmountWithCommission, YELII_COMMISSION_RATE, resolveDueAmount, calculateRemainingBalance } from '@sgm-cem/shared'
import { notifyCollecteurNewContribution, notifyInApp, notifyMemberConfirmed } from '../services/notification'
import { syncYeliiContributionStatus, CONTRIBUTION_SYNC_SELECT } from '../services/payment-status.service'

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

/**
 * GET /api/contributions/me
 * Portail membre — historique STRICTEMENT scopé au membre connecté (jamais
 * les contributions d'un autre membre, quel que soit le paramètre membreId
 * envoyé par le client : il est ignoré, on résout toujours via req.user).
 * Filtre optionnel montant min/max (?montantMin=&montantMax=).
 */
router.get('/me', authenticate, requireLevel(1), async (req, res) => {
  const membre = await prisma.membre.findFirst({
    where: { userId: req.user!.userId },
    select: { id: true },
  })
  if (!membre) throw new AppError('NOT_FOUND', 'Profil membre introuvable pour ce compte', 404)

  const { page = '1', limit = '20', montantMin, montantMax } = req.query as Record<string, string>
  const currentPage = Math.max(1, parseInt(page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
  const skip = (currentPage - 1) * pageSize

  const montantFilter: { gte?: number; lte?: number } = {}
  if (montantMin) montantFilter.gte = parseInt(montantMin, 10)
  if (montantMax) montantFilter.lte = parseInt(montantMax, 10)

  const where = {
    membreId: membre.id,
    ...(Object.keys(montantFilter).length > 0 && { montant: montantFilter }),
  }

  const [contributions, total] = await Promise.all([
    prisma.contribution.findMany({
      where,
      skip,
      take: pageSize,
      include: {
        rubrique: { select: { title: true, code: true } },
        collecteur: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.contribution.count({ where }),
  ])

  res.json({
    success: true,
    data: contributions,
    pagination: { page: currentPage, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) },
  })
})

/**
 * GET /api/contributions/me/balance
 * Reste à payer par rubrique ouverte pour le membre connecté, calculé via
 * la fonction partagée resolveDueAmount/calculateRemainingBalance
 * (packages/shared) — même logique que la création de contribution, jamais
 * dupliquée. Le montant "en attente" est affiché séparément, jamais déduit
 * du solde restant (seul un statut CONFIRME réduit le reste à payer).
 */
router.get('/me/balance', authenticate, requireLevel(1), async (req, res) => {
  const membre = await prisma.membre.findFirst({
    where: { userId: req.user!.userId },
    select: { id: true, profilFinancier: true },
  })
  if (!membre) throw new AppError('NOT_FOUND', 'Profil membre introuvable pour ce compte', 404)

  const [rubriques, aggregates] = await Promise.all([
    prisma.rubrique.findMany({
      where: { status: 'OUVERTE' },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.contribution.groupBy({
      by: ['rubriqueId', 'statut'],
      where: { membreId: membre.id, statut: { in: ['CONFIRME', 'EN_ATTENTE_CONFIRMATION'] } },
      _sum: { montant: true },
    }),
  ])

  const balances = rubriques.map(rubrique => {
    const confirmedAmount = aggregates.find(a => a.rubriqueId === rubrique.id && a.statut === 'CONFIRME')?._sum.montant ?? 0
    const pendingAmount = aggregates.find(a => a.rubriqueId === rubrique.id && a.statut === 'EN_ATTENTE_CONFIRMATION')?._sum.montant ?? 0
    // calculateRemainingBalance attend des contributions individuelles ; on lui passe les
    // sommes déjà agrégées en base (groupBy) sous forme de deux "contributions" virtuelles,
    // pour éviter de recharger chaque contribution individuellement.
    const virtualContributions: { montant: number; statut: 'CONFIRME' | 'EN_ATTENTE_CONFIRMATION' }[] = []
    if (confirmedAmount > 0) virtualContributions.push({ montant: confirmedAmount, statut: 'CONFIRME' })
    if (pendingAmount > 0) virtualContributions.push({ montant: pendingAmount, statut: 'EN_ATTENTE_CONFIRMATION' })
    return {
      rubrique: { id: rubrique.id, code: rubrique.code, title: rubrique.title, priority: rubrique.priority },
      ...calculateRemainingBalance(membre.profilFinancier, rubrique, virtualContributions),
    }
  })

  res.json({ success: true, data: balances })
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

  const montantAttendu = resolveDueAmount(membre.profilFinancier, rubrique)

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

  let receiptUrl = contribution.receiptUrl
  if (isDirectCash) {
    receiptUrl = await generateReceiptPDF(contribution.id)
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

  res.status(201).json({ success: true, data: { ...contribution, receiptUrl } })
})

/**
 * POST /api/contributions/declare
 * Deux usages distincts selon le rôle de l'appelant :
 *  - MEMBRE (level 1) : déclaration personnelle — "j'ai remis X FCFA en
 *    espèces au collecteur Y" → rattachée à SON membreId, visible dans son
 *    historique. Double validation : reste EN_ATTENTE_CONFIRMATION tant que
 *    ce collecteur précis n'a pas confirmé depuis son propre compte (voir
 *    PATCH /:id/confirm) — jamais avant.
 *  - Collecteur/Trésorier (level ≥ 2) : flow existant "remise groupée",
 *    sans membreId (montant remis en bloc, non affecté à un membre).
 */
router.post('/declare', authenticate, requireLevel(1), async (req, res) => {
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

  let membreId: string | undefined
  let declarantName = `Remise groupée déclarée par ${req.user!.email}`
  if (req.user!.role === 'MEMBRE') {
    const membre = await prisma.membre.findFirst({
      where: { userId: req.user!.userId },
      select: { id: true, user: { select: { fullName: true } } },
    })
    if (!membre) throw new AppError('NOT_FOUND', 'Profil membre introuvable pour ce compte', 404)
    membreId = membre.id
    declarantName = membre.user.fullName
  }

  const contribution = await prisma.contribution.create({
    data: {
      membreId,
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
      details: {
        montant: contribution.montant, statut: contribution.statut,
        declaredForCollecteurId: data.collecteurId, viaDeclare: true,
        ...(membreId && { selfDeclaredByMembre: true }),
      },
    },
  })

  try {
    await notifyCollecteurNewContribution({
      collecteurId: data.collecteurId,
      collecteurPhone: collecteur.whatsappPhone ?? collecteur.phone,
      memberName: declarantName,
      montant: contribution.montant,
      rubriqueCode: contribution.rubrique.code,
      contributionId: contribution.id,
    })
  } catch (e) {
    console.error('[Notification] Échec notification collecteur (declare):', e)
  }

  res.status(201).json({ success: true, data: contribution })
})

router.get('/:id/payment-status', authenticate, requireLevel(2), async (req, res) => {
  const contribution = await prisma.contribution.findUnique({
    where: { id: String(req.params.id) },
    select: CONTRIBUTION_SYNC_SELECT,
  })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)

  const synced = await syncYeliiContributionStatus(contribution)
  res.json({ success: true, data: { id: synced.id, statut: synced.statut } })
})

router.patch('/:id/confirm', authenticate, requireLevel(2), async (req, res) => {
  const id = String(req.params.id)
  const contribution = await prisma.contribution.findUnique({
    where: { id },
    include: {
      membre: { include: { user: { select: { id: true, fullName: true, phone: true, whatsappPhone: true, email: true } } } },
      rubrique: { select: { code: true } },
    },
  })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  if (req.user!.role === 'COLLECTEUR' && contribution.collecteurId !== req.user!.userId) {
    throw new AppError('INSUFFICIENT_PERMISSIONS', 'Vous ne pouvez confirmer que vos propres contributions', 403)
  }
  // RB-02 : un paiement Mobile Money/carte ne doit JAMAIS être confirmé manuellement —
  // seul un webhook Yelii vérifié ou une vérification live du statut peut le faire.
  if (contribution.modePaiement !== 'ESPECES') {
    throw new AppError('BUSINESS_RULE', 'Seules les contributions en espèces peuvent être confirmées manuellement', 400)
  }
  if (contribution.statut !== 'EN_ATTENTE_CONFIRMATION') {
    throw new AppError('BUSINESS_RULE', 'Cette contribution ne peut pas etre confirmee')
  }

  // Override hiérarchique : un rôle ≥ TRESORIER peut confirmer à la place du
  // collecteur désigné (débloquer un paiement si celui-ci est indisponible —
  // autorisé, mais tracé distinctement de la confirmation par le collecteur
  // assigné lui-même, et celui-ci en est notifié).
  const isOverride = !!contribution.collecteurId && contribution.collecteurId !== req.user!.userId
  const assignedCollecteur = isOverride
    ? await prisma.user.findUnique({ where: { id: contribution.collecteurId! }, select: { id: true, fullName: true } })
    : null

  const updated = await prisma.contribution.update({
    where: { id },
    data: { statut: 'CONFIRME', confirmedAt: new Date(), confirmedById: req.user!.userId }
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: isOverride ? 'CONFIRM_OVERRIDE' : 'CONFIRM',
      entityType: 'Contribution',
      entityId: updated.id,
      details: {
        montant: updated.montant,
        ...(isOverride && {
          overrideByRole: req.user!.role,
          overrideByName: req.user!.email,
          assignedCollecteurId: contribution.collecteurId,
          assignedCollecteurName: assignedCollecteur?.fullName ?? null,
        }),
      },
    }
  })

  if (isOverride && assignedCollecteur) {
    try {
      await notifyInApp(
        assignedCollecteur.id,
        'Contribution confirmée à votre place',
        `${req.user!.email} (${req.user!.role}) a confirmé à votre place une contribution de ${updated.montant.toLocaleString('fr-FR')} FCFA qui vous était assignée.`,
        'CONTRIBUTION',
        { contributionId: updated.id, overrideByUserId: req.user!.userId },
        { view: 'contributions', id: updated.id }
      )
    } catch (e) {
      console.error('[Notification] Échec notification override collecteur:', e)
    }
  }

  const receiptUrl = await generateReceiptPDF(updated.id)

  // "Contribution confirmée" côté membre — n'existait nulle part pour ce
  // chemin (confirmation manuelle espèces) avant cet ajout. Rien à notifier
  // si la contribution n'est pas rattachée à un membre (remise groupée sans
  // membreId — flow staff existant, inchangé).
  if (contribution.membre) {
    try {
      await notifyMemberConfirmed({
        userId: contribution.membre.user.id,
        memberPhone: contribution.membre.user.whatsappPhone ?? contribution.membre.user.phone,
        memberEmail: contribution.membre.user.email,
        memberName: contribution.membre.user.fullName,
        montant: updated.montant,
        rubriqueCode: contribution.rubrique.code,
        receiptUrl,
        contributionId: updated.id,
      })
    } catch (e) {
      console.error('[Notification] Échec notification membre (confirm espèces):', e)
    }
  }

  res.json({ success: true, data: { ...updated, receiptUrl } })
})

router.patch('/:id/litige', authenticate, requireLevel(2), async (req, res) => {
  const { motif } = z.object({ motif: z.string().min(10) }).parse(req.body)
  const id = String(req.params.id)

  const contribution = await prisma.contribution.findUnique({ where: { id } })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  if (req.user!.role === 'COLLECTEUR' && contribution.collecteurId !== req.user!.userId) {
    throw new AppError('INSUFFICIENT_PERMISSIONS', 'Vous ne pouvez contester que vos propres contributions', 403)
  }

  const updated = await prisma.contribution.update({
    where: { id },
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

  let receiptUrl = updated.receiptUrl
  if (resolution === 'CONFIRME') {
    receiptUrl = await generateReceiptPDF(updated.id)
  }

  res.json({ success: true, data: { ...updated, receiptUrl } })
})

/**
 * GET /api/contributions/:id/receipt
 * Reçu PDF — vue inline par défaut (?download=1 force le téléchargement).
 * Réutilise le PDF déjà généré s'il existe (webhook/confirmation), sinon le
 * génère à la volée (auto-guérison pour les contributions confirmées avant
 * la mise en place de la génération automatique).
 */
router.get('/:id/receipt', authenticate, requireLevel(1), async (req, res) => {
  const id = String(req.params.id)
  const contribution = await prisma.contribution.findUnique({ where: { id } })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)

  // MEMBRE : uniquement son propre reçu. Les rôles ≥ COLLECTEUR gardent
  // l'accès existant à n'importe quel reçu (déjà le cas avant ce changement).
  if (req.user!.role === 'MEMBRE') {
    const membre = await prisma.membre.findFirst({ where: { userId: req.user!.userId }, select: { id: true } })
    if (!membre || contribution.membreId !== membre.id) {
      throw new AppError('INSUFFICIENT_PERMISSIONS', 'Vous ne pouvez consulter que vos propres reçus', 403)
    }
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
    await generateReceiptPDF(id) // persiste receiptUrl pour les prochains appels
  }

  const filename = `Recu-CEM-${id.substring(0, 8).toUpperCase()}.pdf`
  const disposition = req.query.download === '1' ? 'attachment' : 'inline'
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`)
  res.send(pdfBuffer)
})

export { router as contributionsRouter }
