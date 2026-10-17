import { Router } from 'express'
import { z } from 'zod'
import { LocalisationFonds, ModePaiement, Prisma } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { syncPaymentContributionStatus } from '../services/payment-status.service'
import { generateReceiptPDF, generateReceiptPdf } from '../services/receipt'
import { getFileStream } from '../services/storage'
import { getConfig } from '../services/config.service'
import { notifyCollecteurNewContribution } from '../services/notification'
import { calculateRemainingBalance } from '@sgm-cem/shared'
import { getPrisma } from '../lib/prisma'
import { confirmIntoLedger, recordDirectEntry } from '../services/fund-ledger.service'
import {
  assertContributionAction,
  assertContributionReadable,
  assertResolutionAllowed,
  getContributionScope,
  withActions,
  type ContributionActor,
} from '../services/contribution-access.service'

const router = Router()
const prisma = getPrisma()

function actorOf(req: { user?: { userId: string; role: string } }): ContributionActor {
  return { userId: req.user!.userId, role: req.user!.role }
}

// Saisie manuelle par le staff : espèces et virements seulement. Mobile Money et
// carte passent par le parcours de paiement (/payments/initiate, commission,
// webhook, réconciliation) et ne sont confirmés QUE par le prestataire (RG-13).
const STAFF_ENTRY_MODES = ['ESPECES', 'VIREMENT'] as const

const createSchema = z.object({
  membreId: z.string(),
  rubriqueId: z.string(),
  collecteurId: z.string().optional(),
  montant: z.number().int().positive(),
  modePaiement: z.enum(STAFF_ENTRY_MODES, {
    error: 'Mode non saisissable : les paiements Mobile Money et carte passent par le paiement en ligne',
  }),
  periodeLabel: z.string().optional(),
  mobileMoneyPhone: z.string().optional(),
  paymentChannel: z.enum(['MTN', 'ORANGE']).optional(),
  referencePaiement: z.string().optional(),
  // B1 — collecteur encaisse en présentiel : confirmation immédiate, pas de double validation.
  directCollection: z.boolean().optional(),
  // Clé d'idempotence (saisie hors ligne rejouée) — voir findReplayedContribution
  clientRequestId: z.string().uuid().optional(),
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
  const { page = '1', limit = '20', statut, rubriqueId, membreId, localisation, search, modePaiement } = req.query as Record<string, string>
  const currentPage = Math.max(1, parseInt(page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
  const skip = (currentPage - 1) * pageSize
  // Filtres côté serveur (jamais de filtrage d'une seule page dans le navigateur)
  const localisations = localisation
    ? z.array(z.nativeEnum(LocalisationFonds)).parse(localisation.split(',').filter(Boolean))
    : undefined
  const term = search?.trim().slice(0, 80)

  // Périmètre : un collecteur ne voit que les contributions qui lui sont attribuées
  const where: Prisma.ContributionWhereInput = {
    AND: [
      getContributionScope(actorOf(req)),
      {
        ...(statut && { statut: statut as never }),
        ...(rubriqueId && { rubriqueId }),
        ...(membreId && { membreId }),
        ...(localisations && { localisationFonds: { in: localisations } }),
        ...(modePaiement && { modePaiement: z.nativeEnum(ModePaiement).parse(modePaiement) }),
      },
      ...(term ? [{
        OR: [
          { membre: { user: { fullName: { contains: term, mode: 'insensitive' as const } } } },
          { contributeurExterne: { nom: { contains: term, mode: 'insensitive' as const } } },
          { rubrique: { title: { contains: term, mode: 'insensitive' as const } } },
          { rubrique: { code: { contains: term, mode: 'insensitive' as const } } },
        ],
      }] : []),
    ],
  }

  const [contributions, total, sum] = await Promise.all([
    prisma.contribution.findMany({
      where,
      skip,
      take: pageSize,
      include: {
        membre: { include: { user: { select: { fullName: true } } } },
        contributeurExterne: { select: { nom: true } },
        rubrique: { select: { title: true, code: true } },
        collecteur: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.contribution.count({ where }),
    prisma.contribution.aggregate({ where, _sum: { montant: true } }),
  ])
  const totalAmount = sum._sum.montant ?? 0

  res.json({
    success: true,
    data: withActions(actorOf(req), contributions),
    pagination: { page: currentPage, limit: pageSize, total, totalPages: Math.ceil(total / pageSize), totalAmount }
  })
})

router.get('/validations', authenticate, requireLevel(2), async (req, res) => {
  const contributions = await prisma.contribution.findMany({
    where: {
      ...getContributionScope(actorOf(req)),
      statut: 'EN_ATTENTE_CONFIRMATION',
    },
    include: {
      membre: { include: { user: { select: { fullName: true } } } },
      contributeurExterne: { select: { nom: true } },
      rubrique: { select: { title: true, code: true } },
      collecteur: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })

  res.json({ success: true, data: withActions(actorOf(req), contributions) })
})

/**
 * GET /api/contributions/todo
 * Ce qui attend l'utilisateur, dans son périmètre : confirmations qu'il peut
 * réellement faire, transferts de fonds à réceptionner, litiges (niveau ≥ 3).
 * Alimente le bloc « À traiter » des accueils.
 */
router.get('/todo', authenticate, requireLevel(2), async (req, res) => {
  const actor = actorOf(req)
  const [pending, transfersToReceive, openDisputes] = await Promise.all([
    prisma.contribution.findMany({
      where: { ...getContributionScope(actor), statut: 'EN_ATTENTE_CONFIRMATION' },
      select: { id: true, collecteurId: true, statut: true, modePaiement: true, externalTransactionId: true, momoTransactionId: true, transferId: true, bankDepositId: true, localisationFonds: true, montant: true },
      take: 500,
    }),
    prisma.fundsTransfer.count({ where: { receiverId: actor.userId, status: 'PENDING_APPROVAL' } }),
    ['RESPONSABLE', 'ADJOINT_RESPONSABLE', 'TRESORIER', 'ADMIN', 'DEVELOPER'].includes(actor.role)
      ? prisma.contribution.count({ where: { statut: 'LITIGE' } })
      : Promise.resolve(0),
  ])
  const toConfirm = withActions(actor, pending).filter(c => c.actions.canConfirm)
  res.json({
    success: true,
    data: {
      toConfirmCount: toConfirm.length,
      toConfirmAmount: toConfirm.reduce((sum, c) => sum + c.montant, 0),
      transfersToReceive,
      openDisputes,
    },
  })
})

router.get('/litiges', authenticate, requireLevel(3), async (req, res) => {
  const contributions = await prisma.contribution.findMany({
    where: { statut: 'LITIGE' },
    include: {
      membre: { include: { user: { select: { fullName: true } } } },
      contributeurExterne: { select: { nom: true } },
      rubrique: { select: { title: true, code: true } },
      collecteur: { select: { fullName: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  })

  res.json({ success: true, data: withActions(actorOf(req), contributions) })
})

/**
 * GET /api/contributions/me
 * Historique paginé des contributions du MEMBRE connecté (portail self-service,
 * vue "Mes contributions") — filtres optionnels montantMin/montantMax.
 */
router.get('/me', authenticate, requireLevel(1), async (req, res) => {
  const membre = await prisma.membre.findFirst({ where: { userId: req.user!.userId }, select: { id: true } })
  if (!membre) throw new AppError('NOT_FOUND', 'Profil membre introuvable pour ce compte', 404)

  const { page = '1', limit = '20', montantMin, montantMax, search } = req.query as Record<string, string>
  const currentPage = Math.max(1, parseInt(page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
  const skip = (currentPage - 1) * pageSize

  const montantFilter: Record<string, number> = {}
  if (montantMin) montantFilter.gte = parseInt(montantMin, 10)
  if (montantMax) montantFilter.lte = parseInt(montantMax, 10)

  const term = search?.trim().slice(0, 80)
  const where = {
    membreId: membre.id,
    ...(Object.keys(montantFilter).length > 0 && { montant: montantFilter }),
    // Recherche sur TOUTES les contributions, pas seulement la page affichée
    ...(term && { rubrique: { OR: [
      { code: { contains: term, mode: 'insensitive' as const } },
      { title: { contains: term, mode: 'insensitive' as const } },
    ] } }),
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
async function memberBalances(membre: { id: string; profilFinancier: Parameters<typeof calculateRemainingBalance>[0] }) {
  const rubriques = await prisma.rubrique.findMany({
    where: { status: 'OUVERTE' },
    select: {
      id: true, code: true, title: true, priority: true, closeDate: true,
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

  return rubriques.map(rubrique => {
    const confirmedAmount = aggregates.find(a => a.rubriqueId === rubrique.id && a.statut === 'CONFIRME')?._sum.montant ?? 0
    const pendingAmount = aggregates.find(a => a.rubriqueId === rubrique.id && a.statut === 'EN_ATTENTE_CONFIRMATION')?._sum.montant ?? 0
    const virtualContributions: { montant: number; statut: 'CONFIRME' | 'EN_ATTENTE_CONFIRMATION' }[] = []
    if (confirmedAmount > 0) virtualContributions.push({ montant: confirmedAmount, statut: 'CONFIRME' })
    if (pendingAmount > 0) virtualContributions.push({ montant: pendingAmount, statut: 'EN_ATTENTE_CONFIRMATION' })

    const balance = calculateRemainingBalance(membre.profilFinancier, rubrique, virtualContributions)

    return {
      rubrique: { id: rubrique.id, code: rubrique.code, title: rubrique.title, priority: rubrique.priority, closeDate: rubrique.closeDate },
      ...balance,
    }
  })
}

async function currentMembre(userId: string) {
  const membre = await prisma.membre.findFirst({ where: { userId }, select: { id: true, profilFinancier: true } })
  if (!membre) throw new AppError('NOT_FOUND', 'Profil membre introuvable pour ce compte', 404)
  return membre
}

router.get('/me/balance', authenticate, requireLevel(1), async (req, res) => {
  const membre = await currentMembre(req.user!.userId)
  res.json({ success: true, data: await memberBalances(membre) })
})

/**
 * GET /api/contributions/me/summary
 * Totaux du membre calculés sur TOUTES ses contributions (l'écran ne voit
 * qu'une page de 20 lignes) et reste à payer global sur les rubriques ouvertes.
 */
router.get('/me/summary', authenticate, requireLevel(1), async (req, res) => {
  const membre = await currentMembre(req.user!.userId)
  const [byStatut, balances] = await Promise.all([
    prisma.contribution.groupBy({ by: ['statut'], where: { membreId: membre.id }, _sum: { montant: true }, _count: true }),
    memberBalances(membre),
  ])
  const pick = (statut: string) => byStatut.find(g => g.statut === statut)
  const due = balances.filter(b => b.remainingAmount != null && b.remainingAmount > 0)
  res.json({
    success: true,
    data: {
      totalCount: byStatut.reduce((n, g) => n + g._count, 0),
      confirmedAmount: pick('CONFIRME')?._sum.montant ?? 0,
      confirmedCount: pick('CONFIRME')?._count ?? 0,
      pendingAmount: pick('EN_ATTENTE_CONFIRMATION')?._sum.montant ?? 0,
      pendingCount: pick('EN_ATTENTE_CONFIRMATION')?._count ?? 0,
      disputeCount: pick('LITIGE')?._count ?? 0,
      remainingTotal: due.reduce((sum, b) => sum + (b.remainingAmount ?? 0), 0),
      // Les trois rubriques à régler en premier : priorité, puis échéance la plus proche
      nextDue: due
        .sort((a, b) => priorityRank(a.rubrique.priority) - priorityRank(b.rubrique.priority)
          || (a.rubrique.closeDate?.getTime() ?? Infinity) - (b.rubrique.closeDate?.getTime() ?? Infinity))
        .slice(0, 3),
    },
  })
})

function priorityRank(priority: string): number {
  return priority === 'URGENT' ? 0 : priority === 'PRIORITAIRE' ? 1 : 2
}

const CONTRIBUTION_CREATED_INCLUDE = {
  membre: { include: { user: { select: { fullName: true } } } },
  contributeurExterne: { select: { nom: true } },
  rubrique: { select: { title: true, code: true } },
  collecteur: { select: { fullName: true } },
} satisfies Prisma.ContributionInclude

// Un envoi rejoué (réponse perdue, file hors ligne) renvoie la contribution
// déjà créée par le même auteur au lieu d'en créer une seconde.
async function findReplayedContribution(clientRequestId: string | undefined, userId: string) {
  if (!clientRequestId) return null
  const existing = await prisma.contribution.findUnique({
    where: { clientRequestId },
    include: CONTRIBUTION_CREATED_INCLUDE,
  })
  if (!existing) return null
  const author = await prisma.auditLog.findFirst({
    where: { entityType: 'Contribution', entityId: existing.id, action: 'CREATE' },
    select: { userId: true },
  })
  if (author?.userId !== userId) throw new AppError('CONFLICT', 'Cette clé d\'envoi a déjà été utilisée', 409)
  return existing
}

router.post('/', authenticate, requireLevel(2), async (req, res) => {
  const data = createSchema.parse(req.body)
  const { directCollection, paymentChannel, ...contributionData } = data

  const replayed = await findReplayedContribution(data.clientRequestId, req.user!.userId)
  if (replayed) {
    res.status(200).json({ success: true, data: { ...replayed, replayed: true } })
    return
  }

  // Un collecteur n'enregistre que ce qu'il encaisse lui-même ; un superviseur
  // peut attribuer la remise à un autre membre du staff, actif.
  const collecteurId = req.user!.role === 'COLLECTEUR' ? req.user!.userId : (data.collecteurId ?? req.user!.userId)
  if (collecteurId !== req.user!.userId) {
    const designated = await prisma.user.findFirst({
      where: { id: collecteurId, isActive: true, role: { not: 'MEMBRE' } },
      select: { id: true },
    })
    if (!designated) throw new AppError('NOT_FOUND', 'Collecteur désigné introuvable ou inactif', 404)
  }

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

  // B1 — encaissement en présentiel : confirmation immédiate, sans double validation,
  // uniquement par la personne qui a l'argent en main.
  const isDirectCash = data.modePaiement === 'ESPECES' && directCollection === true && collecteurId === req.user!.userId

  let contribution
  try {
    contribution = await prisma.$transaction(async tx => {
      const created = await tx.contribution.create({
        data: {
          ...contributionData,
          collecteurId,
          montantAttendu: montantAttendu ?? data.montant,
          statut: isDirectCash ? 'CONFIRME' : 'EN_ATTENTE_CONFIRMATION',
          localisationFonds: data.modePaiement === 'ESPECES' ? 'CHEZ_COLLECTEUR' : 'EN_TRANSIT',
          confirmedAt: isDirectCash ? new Date() : undefined,
          confirmedById: isDirectCash ? req.user!.userId : undefined,
        },
        include: CONTRIBUTION_CREATED_INCLUDE,
      })
      if (isDirectCash) await recordDirectEntry(tx, created, req.user!.userId)
      return created
    })
  } catch (err) {
    // Deux envois simultanés de la même clé : un seul crée, l'autre est un rejeu
    if (data.clientRequestId && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError('CONFLICT', 'Envoi déjà en cours de traitement, réessayez dans un instant', 409)
    }
    throw err
  }

  let receiptUrl: string | null = null
  if (isDirectCash) {
    receiptUrl = await generateReceiptPDF(contribution.id)
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
  assertContributionReadable(actorOf(req), contribution)

  if (contribution.statut === 'CONFIRME' || contribution.statut === 'ANNULE' || contribution.statut === 'LITIGE') {
    res.json({ success: true, data: { id: contribution.id, statut: contribution.statut } })
    return
  }

  // Même synchronisation que partout ailleurs (contrôle du montant, reçu, audit)
  const synced = await syncPaymentContributionStatus(contribution)
  res.json({ success: true, data: { id: synced.id, statut: synced.statut } })
})

router.patch('/:id/confirm', authenticate, requireLevel(2), async (req, res) => {
  const id = String(req.params.id)
  const contribution = await prisma.contribution.findUnique({ where: { id } })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  if (contribution.statut !== 'EN_ATTENTE_CONFIRMATION') {
    throw new AppError('BUSINESS_RULE', 'Cette contribution ne peut pas être confirmée')
  }
  // Espèces et virements seulement, par le collecteur désigné ou un administrateur
  assertContributionAction(actorOf(req), contribution, 'canConfirm')

  // Transition conditionnelle (deux confirmations simultanées n'en font qu'une) et
  // entrée de l'argent dans le grand livre : espèces chez le collecteur, virement
  // chez le trésorier
  const confirmed = await prisma.$transaction(tx => confirmIntoLedger(tx, contribution, { confirmedById: req.user!.userId }))
  if (!confirmed) throw new AppError('BUSINESS_RULE', 'Cette contribution a déjà été traitée')
  const updated = await prisma.contribution.findUniqueOrThrow({ where: { id } })

  const override = contribution.collecteurId !== req.user!.userId
  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: override ? 'CONFIRM_OVERRIDE' : 'CONFIRM',
      entityType: 'Contribution',
      entityId: updated.id,
      details: { montant: updated.montant, modePaiement: updated.modePaiement, ...(override && { designatedCollecteurId: contribution.collecteurId }) },
    }
  })

  const receiptUrl = await generateReceiptPDF(updated.id)
  res.json({ success: true, data: { ...updated, receiptUrl } })
})

// Refus d'une déclaration en attente (argent non reçu) : distinct du litige,
// la contribution est annulée avec son motif.
router.patch('/:id/refuse', authenticate, requireLevel(2), async (req, res) => {
  const { motif } = z.object({ motif: z.string().trim().min(10, 'Motif de 10 caractères minimum').max(500) }).parse(req.body)
  const id = String(req.params.id)
  const contribution = await prisma.contribution.findUnique({ where: { id } })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  assertContributionAction(actorOf(req), contribution, 'canRefuse')

  const result = await prisma.contribution.updateMany({
    where: { id, statut: 'EN_ATTENTE_CONFIRMATION' },
    data: { statut: 'ANNULE', paymentStatus: 'CANCELLED', litigeMotif: `Refusée : ${motif}` },
  })
  if (result.count !== 1) throw new AppError('BUSINESS_RULE', 'Cette contribution a déjà été traitée')
  const updated = await prisma.contribution.findUniqueOrThrow({ where: { id } })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'REJECT',
      entityType: 'Contribution',
      entityId: id,
      details: { action: 'refuse', motif, montant: contribution.montant },
    },
  })

  res.json({ success: true, data: updated })
})

router.patch('/:id/litige', authenticate, requireLevel(3), async (req, res) => {
  const { motif } = z.object({ motif: z.string().trim().min(10).max(1000) }).parse(req.body)
  const id = String(req.params.id)
  const contribution = await prisma.contribution.findUnique({ where: { id } })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  // Superviseurs uniquement, et tant que les fonds n'ont pas quitté le collecteur
  assertContributionAction(actorOf(req), contribution, 'canDispute')

  const result = await prisma.contribution.updateMany({
    where: { id, statut: contribution.statut },
    data: { statut: 'LITIGE', litigeMotif: motif },
  })
  if (result.count !== 1) throw new AppError('BUSINESS_RULE', 'Cette contribution a changé entre-temps, rechargez la page')
  const updated = await prisma.contribution.findUniqueOrThrow({ where: { id } })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'REJECT',
      entityType: 'Contribution',
      entityId: updated.id,
      details: { motif, previousStatut: contribution.statut },
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
  if (contribution.statut !== 'LITIGE') throw new AppError('BUSINESS_RULE', 'Cette contribution n\'est pas en litige')
  assertResolutionAllowed(actorOf(req), contribution, resolution)

  const result = await prisma.$transaction(async tx => {
    const updatedRows = await tx.contribution.updateMany({
      where: { id, statut: 'LITIGE' },
      data: {
        statut: resolution,
        confirmedAt: resolution === 'CONFIRME' ? new Date() : contribution.confirmedAt,
        confirmedById: resolution === 'CONFIRME' ? req.user!.userId : contribution.confirmedById,
        litigeMotif: note ? `${contribution.litigeMotif ?? ''}\nRésolution : ${note}` : contribution.litigeMotif,
      }
    })
    // Litige ouvert avant toute confirmation : l'argent entre seulement maintenant dans le grand livre
    if (updatedRows.count === 1 && resolution === 'CONFIRME' && !(await tx.fundMovement.findFirst({ where: { contributionId: id }, select: { id: true } }))) {
      await recordDirectEntry(tx, contribution, req.user!.userId)
    }
    return updatedRows
  })
  if (result.count !== 1) throw new AppError('BUSINESS_RULE', 'Ce litige a déjà été traité')
  const updated = await prisma.contribution.findUniqueOrThrow({ where: { id } })

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

const FUND_MOVEMENT_LABELS: Record<string, string> = {
  CONFIRMATION: 'Argent entré dans le circuit',
  TRANSFERT_ENVOI: 'Fonds remis en transfert',
  TRANSFERT_RECEPTION: 'Fonds reçus par le destinataire',
  TRANSFERT_REFUS: 'Transfert refusé, fonds revenus',
  TRANSFERT_ANNULATION: 'Transfert annulé, fonds revenus',
  DEPOT_BANCAIRE: 'Déposé en banque (reçu archivé)',
  REPRISE_INITIALE: 'Position de départ',
}

const LOCATION_LABELS: Record<string, string> = {
  CHEZ_COLLECTEUR: 'Chez le collecteur', EN_TRANSIT: 'En transit', CHEZ_RESPONSABLE: 'Chez le responsable',
  REMIS_TRESORIER: 'Chez le trésorier', EN_CAISSE: 'En caisse', EN_BANQUE: 'En banque',
  PORTEFEUILLE_ELECTRONIQUE: 'Portefeuille électronique',
}

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
      contributeurExterne: { select: { nom: true } },
      rubrique: { select: { title: true, code: true } },
      fundsTransfer: { select: { senderName: true, receiverName: true, status: true, createdAt: true, confirmedAt: true, refusedAt: true, cancelledAt: true, transferType: true } },
      bankDeposit: { select: { referenceBordereau: true, depositedByName: true, createdAt: true } },
    },
  })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  assertContributionReadable(actorOf(req), contribution)

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

  // Trajet réel de l'argent : grand livre des fonds (tout l'historique). Les
  // événements antérieurs à sa mise en service viennent de l'ancien suivi.
  const movements = await prisma.fundMovement.findMany({ where: { contributionId: id }, orderBy: [{ at: 'asc' }, { id: 'asc' }] })
  const ledgerStart = movements.find(m => m.reason === 'REPRISE_INITIALE')?.at ?? (movements.length ? null : undefined)
  const beforeLedger = (at: Date) => ledgerStart === undefined || (ledgerStart !== null && at < ledgerStart)
  const personIds = Array.from(new Set(movements.flatMap(m => [m.actorId, m.holderToId]).filter((v): v is string => Boolean(v))))
  const people = new Map((await prisma.user.findMany({ where: { id: { in: personIds } }, select: { id: true, fullName: true } })).map(u => [u.id, u.fullName]))
  for (const m of movements) {
    if (m.reason === 'REPRISE_INITIALE') continue
    timeline.push({
      step: `FONDS_${m.reason}`,
      label: FUND_MOVEMENT_LABELS[m.reason],
      actor: (m.actorId && people.get(m.actorId)) ?? 'Système',
      at: m.at,
      localisation: `${LOCATION_LABELS[m.toLocation]}${m.holderToId && people.get(m.holderToId) ? ` (${people.get(m.holderToId)})` : ''}`,
    })
  }

  if (contribution.fundsTransfer && beforeLedger(contribution.fundsTransfer.createdAt)) {
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
  if (contribution.bankDeposit && beforeLedger(contribution.bankDeposit.createdAt)) {
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
router.get('/:id/receipt', authenticate, requireLevel(1), async (req, res) => {
  const id = String(req.params.id)
  const contribution = await prisma.contribution.findUnique({ where: { id } })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  assertContributionReadable(actorOf(req), contribution)
  // Un membre télécharge les reçus de SES contributions (justificatif perdu, UX-03)
  if (req.user!.role === 'MEMBRE') {
    const membre = await currentMembre(req.user!.userId)
    if (contribution.membreId !== membre.id) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
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
