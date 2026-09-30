import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { getYeliiStatus, requestYelii } from '../services/payment'
import { generateReceiptPDF, generateReceiptPdf } from '../services/receipt'
import { getFileStream } from '../services/storage'
import { getConfig } from '../services/config.service'
import { notifyCollecteurNewContribution } from '../services/notification'
import { calculateRemainingBalance } from '@sgm-cem/shared'

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
  // B1 — collecteur encaisse en présentiel : confirmation immédiate, pas de double validation.
  directCollection: z.boolean().optional(),
})

const MAX_DECLARE_LINES = 50

// Deux formes acceptées : rubriqueId+montant (une seule rubrique, historique)
// OU allocations (répartition sur plusieurs rubriques, comme les autres flows
// de contribution) — exactement l'une des deux, jamais les deux à la fois.
const declareSchema = z.object({
  collecteurId: z.string().min(1, 'Collecteur requis'),
  rubriqueId: z.string().min(1).optional(),
  montant: z.number().int().positive().optional(),
  allocations: z.array(z.object({
    rubriqueId: z.string().min(1),
    montant: z.number().int().positive(),
  })).min(1).max(MAX_DECLARE_LINES).optional(),
  periodeLabel: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
}).refine(
  data => Boolean(data.rubriqueId && data.montant) !== Boolean(data.allocations),
  { message: 'Fournissez soit rubriqueId et montant, soit allocations — jamais les deux ni aucun des deux' }
)

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

router.get('/validations', authenticate, requireLevel(2), async (req, res) => {
  const isCollecteur = req.user!.role === 'COLLECTEUR'
  const contributions = await prisma.contribution.findMany({
    where: {
      statut: 'EN_ATTENTE_CONFIRMATION',
      ...(isCollecteur && { collecteurId: req.user!.userId }),
    },
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
 * Historique paginé des contributions du MEMBRE connecté (portail self-service,
 * vue "Mes contributions") — filtres optionnels montantMin/montantMax.
 */
router.get('/me', authenticate, requireLevel(1), async (req, res) => {
  const membre = await prisma.membre.findFirst({ where: { userId: req.user!.userId }, select: { id: true } })
  if (!membre) throw new AppError('NOT_FOUND', 'Profil membre introuvable pour ce compte', 404)

  const { page = '1', limit = '20', montantMin, montantMax } = req.query as Record<string, string>
  const currentPage = Math.max(1, parseInt(page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
  const skip = (currentPage - 1) * pageSize

  const montantFilter: Record<string, number> = {}
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
 * Solde restant dû du MEMBRE connecté, par rubrique ouverte — alimente les
 * cartes "Reste à payer" (RubriquesMembre.tsx) et les rappels proactifs
 * (MesContributions.tsx). Une seule requête groupée par rubrique/statut,
 * pas de N+1 : les montants confirmé/en attente sont agrégés puis reconstruits
 * en "contributions virtuelles" pour réutiliser calculateRemainingBalance
 * (@sgm-cem/shared, seule source de vérité du calcul).
 */
router.get('/me/balance', authenticate, requireLevel(1), async (req, res) => {
  const membre = await prisma.membre.findFirst({
    where: { userId: req.user!.userId },
    select: { id: true, profilFinancier: true },
  })
  if (!membre) throw new AppError('NOT_FOUND', 'Profil membre introuvable pour ce compte', 404)

  const rubriques = await prisma.rubrique.findMany({
    where: { status: 'OUVERTE' },
    select: {
      id: true, code: true, title: true, priority: true,
      amountTravailleur: true, amountEtudiant: true, amountCouple: true,
    },
  })

  const aggregates = await prisma.contribution.groupBy({
    by: ['rubriqueId', 'statut'],
    where: {
      membreId: membre.id,
      rubriqueId: { in: rubriques.map(r => r.id) },
      statut: { in: ['CONFIRME', 'EN_ATTENTE_CONFIRMATION'] },
    },
    _sum: { montant: true },
  })

  const data = rubriques.map(rubrique => {
    const confirmedAmount = aggregates.find(a => a.rubriqueId === rubrique.id && a.statut === 'CONFIRME')?._sum.montant ?? 0
    const pendingAmount = aggregates.find(a => a.rubriqueId === rubrique.id && a.statut === 'EN_ATTENTE_CONFIRMATION')?._sum.montant ?? 0
    const virtualContributions: { montant: number; statut: 'CONFIRME' | 'EN_ATTENTE_CONFIRMATION' }[] = []
    if (confirmedAmount > 0) virtualContributions.push({ montant: confirmedAmount, statut: 'CONFIRME' })
    if (pendingAmount > 0) virtualContributions.push({ montant: pendingAmount, statut: 'EN_ATTENTE_CONFIRMATION' })

    const balance = calculateRemainingBalance(membre.profilFinancier, rubrique, virtualContributions)

    return {
      rubrique: { id: rubrique.id, code: rubrique.code, title: rubrique.title, priority: rubrique.priority },
      ...balance,
    }
  })

  res.json({ success: true, data })
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

  let receiptUrl: string | null = null
  if (isDirectCash) {
    receiptUrl = await generateReceiptPDF(contribution.id)
  }

  if (data.modePaiement === 'YELII' && data.mobileMoneyPhone) {
    const payment = await requestYelii({
      phone: data.mobileMoneyPhone,
      amount: contribution.montant,
      externalId: contribution.id,
      channel: data.paymentChannel === 'ORANGE' ? 'ORANGE' : 'MTN',
      note: `Contribution ${contribution.id}`,
    })

    await prisma.contribution.update({
      where: { id: contribution.id },
      data: {
        momoTransactionId: payment.transactionId || undefined,
        referencePaiement: payment.externalId ?? contribution.id,
        ...(payment.success ? {} : { statut: 'ANNULE', litigeMotif: payment.message ?? 'Échec de la collecte Yelii' }),
      },
    })
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

router.post('/declare', authenticate, requireLevel(1), async (req, res) => {
  const data = declareSchema.parse(req.body)
  const lines = data.allocations ?? [{ rubriqueId: data.rubriqueId!, montant: data.montant! }]

  const ids = new Set<string>()
  for (const line of lines) {
    if (ids.has(line.rubriqueId)) throw new AppError('VALIDATION', 'Une même rubrique est répétée dans la répartition')
    ids.add(line.rubriqueId)
  }

  // Un MEMBRE ne déclare que pour lui-même — la déclaration alimente alors son
  // propre historique ; le staff (COLLECTEUR+) déclare pour un tiers sans
  // compte (remise groupée), donc sans membreId, comportement déjà établi.
  const isSelfService = req.user!.role === 'MEMBRE'
  let membreId: string | null = null
  if (isSelfService) {
    const membre = await prisma.membre.findFirst({ where: { userId: req.user!.userId }, select: { id: true } })
    if (!membre) throw new AppError('NOT_FOUND', 'Profil membre introuvable pour ce compte', 404)
    membreId = membre.id
  }

  const [rubriques, collecteur] = await Promise.all([
    prisma.rubrique.findMany({ where: { id: { in: Array.from(ids) } } }),
    prisma.user.findFirst({
      where: { id: data.collecteurId, isActive: true, role: { in: ['TRESORIER', 'COLLECTEUR'] } },
      select: { id: true, fullName: true, phone: true, whatsappPhone: true },
    }),
  ])

  if (rubriques.length !== ids.size || rubriques.some(r => r.status !== 'OUVERTE')) {
    throw new AppError('BUSINESS_RULE', 'Une ou plusieurs rubriques sont fermées ou introuvables')
  }
  if (!collecteur) {
    throw new AppError('NOT_FOUND', 'Collecteur introuvable ou rôle non éligible', 404)
  }

  const rubriqueById = new Map(rubriques.map(r => [r.id, r]))
  const contributions = await prisma.$transaction(
    lines.map(line => prisma.contribution.create({
      data: {
        membreId,
        rubriqueId: line.rubriqueId,
        collecteurId: data.collecteurId,
        montant: line.montant,
        montantAttendu: line.montant,
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
    }))
  )

  const totalMontant = contributions.reduce((sum, c) => sum + c.montant, 0)

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'CREATE',
      entityType: 'Contribution',
      entityId: contributions[0].id,
      details: {
        montant: totalMontant,
        statut: 'EN_ATTENTE_CONFIRMATION',
        declaredForCollecteurId: data.collecteurId,
        viaDeclare: true,
        contributionIds: contributions.map(c => c.id),
        rubriques: contributions.map(c => rubriqueById.get(c.rubriqueId)?.code ?? c.rubriqueId),
      },
    },
  })

  try {
    await notifyCollecteurNewContribution({
      collecteurId: data.collecteurId,
      collecteurPhone: collecteur.whatsappPhone ?? collecteur.phone,
      memberName: isSelfService ? req.user!.email : `Remise groupée déclarée par ${req.user!.email}`,
      montant: totalMontant,
      rubriqueCode: contributions.length > 1 ? `${contributions.length} rubriques` : contributions[0].rubrique.code,
      contributionId: contributions[0].id,
    })
  } catch (e) {
    console.error('[Notification] Échec notification collecteur (declare):', e)
  }

  res.status(201).json({ success: true, data: data.allocations ? contributions : contributions[0] })
})

router.get('/:id/payment-status', authenticate, requireLevel(2), async (req, res) => {
  const contribution = await prisma.contribution.findUnique({ where: { id: String(req.params.id) } })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)

  if (contribution.statut === 'CONFIRME' || contribution.statut === 'ANNULE' || contribution.statut === 'LITIGE') {
    res.json({ success: true, data: { id: contribution.id, statut: contribution.statut } })
    return
  }

  if (contribution.modePaiement === 'YELII' && contribution.momoTransactionId) {
    const remoteStatus = await getYeliiStatus(contribution.momoTransactionId)
    if (remoteStatus === 'CONFIRMED' && contribution.statut === 'EN_ATTENTE_CONFIRMATION') {
      const updated = await prisma.contribution.update({
        where: { id: contribution.id },
        data: { statut: 'CONFIRME', confirmedAt: new Date(), referencePaiement: contribution.referencePaiement ?? contribution.momoTransactionId },
      })
      res.json({ success: true, data: { id: updated.id, statut: updated.statut } })
      return
    }
    if (remoteStatus === 'FAILED' && contribution.statut === 'EN_ATTENTE_CONFIRMATION') {
      const updated = await prisma.contribution.update({
        where: { id: contribution.id },
        data: { statut: 'ANNULE', litigeMotif: 'Paiement Yelii échoué ou annulé.' },
      })
      res.json({ success: true, data: { id: updated.id, statut: updated.statut } })
      return
    }
  }

  res.json({ success: true, data: { id: contribution.id, statut: contribution.statut } })
})

router.patch('/:id/confirm', authenticate, requireLevel(2), async (req, res) => {
  const id = String(req.params.id)
  const contribution = await prisma.contribution.findUnique({ where: { id } })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  if (contribution.statut !== 'EN_ATTENTE_CONFIRMATION') {
    throw new AppError('BUSINESS_RULE', 'Cette contribution ne peut pas etre confirmee')
  }
  if (req.user!.role === 'COLLECTEUR' && contribution.collecteurId !== req.user!.userId) {
    throw new AppError('ACCESS_DENIED', 'Vous ne pouvez confirmer que vos propres remises', 403)
  }

  const updated = await prisma.contribution.update({
    where: { id },
    data: {
      statut: 'CONFIRME',
      paymentStatus: 'SUCCESS',
      confirmedAt: new Date(),
      confirmedById: req.user!.userId,
    }
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

  const receiptUrl = await generateReceiptPDF(updated.id)
  res.json({ success: true, data: { ...updated, receiptUrl } })
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

  res.json({ success: true, data: updated })
})

const TIMELINE_ACTION_LABELS: Record<string, string> = {
  CREATE: 'Contribution créée',
  CONFIRM: 'Paiement confirmé',
  REJECT: 'Mise en litige',
  APPROVE: 'Litige résolu — confirmée',
}

/**
 * GET /api/contributions/:id/timeline
 * Traçabilité de fonds d'une contribution — journal d'audit (créée, confirmée,
 * mise en litige, résolue) enrichi du trajet réel de l'argent une fois collecté
 * en espèces (transfert collecteur → responsable/trésorier, puis dépôt bancaire).
 * Affichée par le bouton "Voir la traçabilité" de la liste des contributions.
 */
router.get('/:id/timeline', authenticate, requireLevel(2), async (req, res) => {
  const id = String(req.params.id)
  const contribution = await prisma.contribution.findUnique({
    where: { id },
    include: {
      membre: { include: { user: { select: { fullName: true } } } },
      rubrique: { select: { title: true, code: true } },
      fundsTransfer: { select: { senderName: true, receiverName: true, status: true, createdAt: true, confirmedAt: true, refusedAt: true, cancelledAt: true, transferType: true } },
      bankDeposit: { select: { referenceBordereau: true, depositedByName: true, createdAt: true } },
    },
  })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)

  const auditLogs = await prisma.auditLog.findMany({
    where: { entityType: 'Contribution', entityId: id },
    orderBy: { createdAt: 'asc' },
  })

  type Step = { step: string; label: string; actor: string; at: Date; localisation?: string }
  const timeline: Step[] = auditLogs.map(log => ({
    step: log.action,
    label: TIMELINE_ACTION_LABELS[log.action] ?? log.action,
    actor: log.userName,
    at: log.createdAt,
  }))

  // Repli minimal si la contribution est antérieure à la mise en place de
  // l'audit systématique (aucune entrée trouvée) — évite une timeline vide.
  if (timeline.length === 0) {
    timeline.push({
      step: 'CREATE',
      label: 'Contribution créée',
      actor: contribution.collecteurId ? 'Collecteur' : 'Système',
      at: contribution.createdAt,
    })
  }

  // Trajet réel de l'argent (espèces uniquement) — la collecte publique/Mobile
  // Money/Carte n'a pas de FundsTransfer, aucune ligne supplémentaire alors.
  if (contribution.fundsTransfer) {
    const ft = contribution.fundsTransfer
    timeline.push({
      step: 'TRANSFER',
      label: 'Fonds remis en transfert',
      actor: `${ft.senderName} → ${ft.receiverName}`,
      at: ft.createdAt,
      localisation: `Type : ${ft.transferType}`,
    })
    if (ft.confirmedAt) {
      timeline.push({ step: 'TRANSFER_CONFIRMED', label: 'Transfert confirmé par le destinataire', actor: ft.receiverName, at: ft.confirmedAt })
    }
    if (ft.refusedAt) {
      timeline.push({ step: 'TRANSFER_REFUSED', label: 'Transfert refusé par le destinataire', actor: ft.receiverName, at: ft.refusedAt })
    }
    if (ft.cancelledAt) {
      timeline.push({ step: 'TRANSFER_CANCELLED', label: 'Transfert annulé', actor: ft.senderName, at: ft.cancelledAt })
    }
  }
  if (contribution.bankDeposit) {
    timeline.push({
      step: 'BANK_DEPOSIT',
      label: 'Déposé en banque',
      actor: contribution.bankDeposit.depositedByName,
      at: contribution.bankDeposit.createdAt,
      localisation: `Bordereau : ${contribution.bankDeposit.referenceBordereau}`,
    })
  }

  // Plus récent en premier — l'état actuel de la contribution est donc le
  // premier élément affiché (mis en avant côté frontend).
  timeline.sort((a, b) => b.at.getTime() - a.at.getTime())

  res.json({
    success: true,
    data: {
      contribution: {
        membre: contribution.membre?.user.fullName ?? null,
        rubrique: contribution.rubrique ? `${contribution.rubrique.code} — ${contribution.rubrique.title}` : null,
        montant: contribution.montant,
        statut: contribution.statut,
      },
      timeline,
    },
  })
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
