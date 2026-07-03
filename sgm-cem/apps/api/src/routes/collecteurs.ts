import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'

const router = Router()
const prisma = new PrismaClient()

const transferSchema = z.object({
  contributionIds: z.array(z.string()).min(1).max(100),
  localisationFonds: z.enum(['EN_CAISSE', 'EN_BANQUE', 'EN_TRANSIT']),
  note: z.string().max(500).optional(),
})

const transferToUserSchema = z.object({
  contributionIds: z.array(z.string()).min(1).max(100),
  toUserId: z.string().min(1),
  note: z.string().max(500).optional(),
})

const claimSchema = z.object({
  contributionIds: z.array(z.string()).min(1).max(100),
  note: z.string().max(500).optional(),
})

router.get('/', authenticate, requireLevel(2), async (req, res) => {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } })
  const maxRetentionDays = settings?.maxFundsRetentionDays ?? 7
  const retentionLimit = new Date(Date.now() - maxRetentionDays * 24 * 60 * 60 * 1000)

  const myRole = req.user?.role
  const myUserId = req.user?.userId

  const [contributions, flowGroups, modeGroups, users] = await Promise.all([
    prisma.contribution.findMany({
      where: {
        statut: 'CONFIRME',
        localisationFonds: { in: ['CHEZ_COLLECTEUR', 'EN_TRANSIT'] },
        ...(myRole === 'COLLECTEUR' ? { collecteurId: myUserId } : {}),
      },
      include: {
        collecteur: { select: { id: true, fullName: true, email: true, role: true } },
        membre: { include: { user: { select: { fullName: true } } } },
        rubrique: { select: { code: true, title: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.contribution.groupBy({
      by: ['localisationFonds'],
      where: { statut: 'CONFIRME' },
      _sum: { montant: true },
      _count: true,
    }),
    prisma.contribution.groupBy({
      by: ['modePaiement'],
      where: { statut: 'CONFIRME' },
      _sum: { montant: true },
    }),
    prisma.user.findMany({
      where: { isActive: true, role: { in: ['TRESORIER', 'COLLECTEUR'] } },
      select: { id: true, fullName: true, email: true, role: true },
      orderBy: { role: 'asc' },
    }),
  ])

  const eligibleRecipients = users
    .filter(u => myRole !== 'COLLECTEUR' || u.id !== myUserId)
    .map(u => ({ id: u.id, fullName: u.fullName, email: u.email, role: u.role }))

  const byCollector = new Map<string, {
    collecteurId: string
    collecteurName: string
    collecteurEmail?: string
    totalChezCollecteur: number
    totalEnTransit: number
    totalARemettre: number
    nbContributions: number
    nbEnRetard: number
    oldestContributionAt?: Date
  }>()

  for (const contribution of contributions) {
    const key = contribution.collecteurId ?? 'sans-collecteur'
    const row = byCollector.get(key) ?? {
      collecteurId: key,
      collecteurName: contribution.collecteur?.fullName ?? 'Sans collecteur',
      collecteurEmail: contribution.collecteur?.email,
      totalChezCollecteur: 0,
      totalEnTransit: 0,
      totalARemettre: 0,
      nbContributions: 0,
      nbEnRetard: 0,
      oldestContributionAt: contribution.createdAt,
    }

    if (contribution.localisationFonds === 'CHEZ_COLLECTEUR') row.totalChezCollecteur += contribution.montant
    if (contribution.localisationFonds === 'EN_TRANSIT') row.totalEnTransit += contribution.montant
    row.totalARemettre += contribution.montant
    row.nbContributions += 1
    if (contribution.createdAt < retentionLimit) row.nbEnRetard += 1
    if (!row.oldestContributionAt || contribution.createdAt < row.oldestContributionAt) {
      row.oldestContributionAt = contribution.createdAt
    }
    byCollector.set(key, row)
  }

  const summary = Array.from(byCollector.values()).sort((a, b) => b.totalARemettre - a.totalARemettre)
  const totalARemettre = summary.reduce((sum, item) => sum + item.totalARemettre, 0)
  const totalEnRetard = summary.reduce((sum, item) => sum + item.nbEnRetard, 0)
  // Répartition par canal — l'argent Mobile Money/Carte est crédité directement
  // chez le trésorier (voir webhooks Yelii/CinetPay), il ne transite jamais par
  // un collecteur. Seules les espèces suivent le chemin collecteur → transit → trésorier.
  const ELECTRONIC_MODES = ['MTN_MOMO', 'ORANGE_MONEY', 'YELII', 'CARTE_VISA']
  const electroniqueTotal = modeGroups
    .filter(g => ELECTRONIC_MODES.includes(g.modePaiement))
    .reduce((sum, g) => sum + (g._sum.montant ?? 0), 0)
  const especesTotal = modeGroups
    .filter(g => !ELECTRONIC_MODES.includes(g.modePaiement))
    .reduce((sum, g) => sum + (g._sum.montant ?? 0), 0)

  const flow = {
    chezCollecteur: amountFor(flowGroups, 'CHEZ_COLLECTEUR'),
    enTransit: amountFor(flowGroups, 'EN_TRANSIT'),
    chezResponsable: amountFor(flowGroups, 'CHEZ_RESPONSABLE'),
    remisTresorier: amountFor(flowGroups, 'REMIS_TRESORIER'),
    enCaisse: amountFor(flowGroups, 'EN_CAISSE'),
    enBanque: amountFor(flowGroups, 'EN_BANQUE'),
    totalConfirme: flowGroups.reduce((sum, item) => sum + (item._sum.montant ?? 0), 0),
    especesTotal,
    electroniqueTotal,
  }

  res.json({
    success: true,
    data: {
      summary,
      contributions,
      totals: {
        totalARemettre,
        totalContributions: contributions.length,
        totalEnRetard,
        maxRetentionDays,
      },
      flow,
      eligibleRecipients,
      myRole,
    }
  })
})

router.patch('/transfer', authenticate, requireLevel(3), async (req, res) => {
  const data = transferSchema.parse(req.body)

  const contributions = await prisma.contribution.findMany({
    where: { id: { in: data.contributionIds } },
    select: { id: true, statut: true, localisationFonds: true, montant: true, collecteurId: true },
  })

  if (contributions.length !== data.contributionIds.length) {
    throw new AppError('NOT_FOUND', 'Une ou plusieurs contributions sont introuvables', 404)
  }

  const invalid = contributions.find(c =>
    c.statut !== 'CONFIRME' ||
    !['CHEZ_COLLECTEUR', 'EN_TRANSIT'].includes(c.localisationFonds)
  )
  if (invalid) {
    throw new AppError('BUSINESS_RULE', 'Seules les contributions confirmees peuvent etre transferees')
  }

  const updated = await prisma.$transaction(async tx => {
    const result = await tx.contribution.updateMany({
      where: { id: { in: data.contributionIds } },
      data: { localisationFonds: data.localisationFonds },
    })

    await tx.auditLog.createMany({
      data: contributions.map(contribution => ({
        userId: req.user!.userId,
        userName: req.user!.email,
        action: 'TRANSFER',
        entityType: 'Contribution',
        entityId: contribution.id,
        details: {
          contributionId: contribution.id,
          fromUserId: contribution.collecteurId,
          fromUserRole: contribution.collecteurId === req.user!.userId ? (req.user!.role ?? 'UNKNOWN') : 'COLLECTEUR',
          toLocation: data.localisationFonds,
          note: data.note,
          actorUserId: req.user!.userId,
          actorUserRole: req.user!.role,
        },
      })),
    })

    return result
  })

  res.json({ success: true, data: { updated: updated.count } })
})

router.patch('/transfer-to-user', authenticate, async (req, res) => {
  const data = transferToUserSchema.parse(req.body)
  const myRole = req.user!.role as 'ADMIN' | 'TRESORIER' | 'RESPONSABLE' | 'ADJOINT_RESPONSABLE' | 'COLLECTEUR' | 'MEMBRE'
  const myUserId = req.user!.userId

  const targetUser = await prisma.user.findFirst({
    where: {
      id: data.toUserId,
      isActive: true,
      role: { in: ['TRESORIER', 'COLLECTEUR'] },
    },
    select: { id: true, fullName: true, role: true },
  })
  if (!targetUser) {
    throw new AppError('INVALID_TARGET', 'Destinataire invalide', 400)
  }

  const where: Record<string, unknown> = {
    id: { in: data.contributionIds },
    statut: 'CONFIRME',
    localisationFonds: 'CHEZ_COLLECTEUR',
  }
  if (myRole === 'COLLECTEUR') {
    ;(where as { collecteurId?: string }).collecteurId = myUserId
  }

  const contributions = await prisma.contribution.findMany({
    where,
    select: { id: true, montant: true, collecteurId: true },
  })
  if (contributions.length !== data.contributionIds.length) {
    throw new AppError('BUSINESS_RULE', "Transfert refuse : contributions invalides ou non autorisees", 403)
  }

  const nextLocation = targetUser.role === 'TRESORIER' ? 'EN_CAISSE' : 'CHEZ_COLLECTEUR'

  const updated = await prisma.$transaction(async tx => {
    const result = await tx.contribution.updateMany({
      where: { id: { in: data.contributionIds } },
      data: {
        localisationFonds: nextLocation,
        collecteurId: targetUser.id,
      },
    })

    await tx.auditLog.createMany({
      data: contributions.map(contribution => ({
        userId: myUserId,
        userName: req.user!.email,
        action: 'TRANSFER',
        entityType: 'Contribution',
        entityId: contribution.id,
        details: {
          contributionId: contribution.id,
          fromUserId: contribution.collecteurId,
          fromUserName: req.user!.email,
          toUserId: targetUser.id,
          toUserName: targetUser.fullName,
          toRole: targetUser.role,
          toLocation: nextLocation,
          note: data.note,
          actorUserId: myUserId,
          actorUserRole: myRole,
        },
      })),
    })

    return result
  })

  res.json({ success: true, data: { updated: updated.count } })
})

router.patch('/claim', authenticate, async (req, res) => {
  const body = typeof req.body === 'object' && req.body ? (req.body as Record<string, unknown>) : {}
  const contributionIds = Array.isArray(body.contributionIds) ? body.contributionIds.filter((id): id is string => typeof id === 'string') : []
  if (contributionIds.length === 0) {
    throw new AppError('VALIDATION', 'contributionIds requis', 400)
  }
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : undefined
  const myUserId = req.user!.userId
  const myRole = req.user!.role as 'ADMIN' | 'TRESORIER' | 'RESPONSABLE' | 'ADJOINT_RESPONSABLE' | 'COLLECTEUR' | 'MEMBRE'

  if (!['TRESORIER', 'COLLECTEUR', 'ADMIN', 'RESPONSABLE', 'ADJOINT_RESPONSABLE'].includes(myRole)) {
    throw new AppError('INSUFFICIENT_PERMISSIONS', 'Role non autorise', 403)
  }

  const contributions = await prisma.contribution.findMany({
    where: { id: { in: contributionIds } },
    select: { id: true, localisationFonds: true, montant: true, collecteurId: true },
  })
  if (contributions.length !== contributionIds.length) {
    throw new AppError('NOT_FOUND', 'Contributions introuvables', 404)
  }

  const invalid = contributions.find(c => c.localisationFonds !== 'EN_TRANSIT')
  if (invalid) {
    throw new AppError('BUSINESS_RULE', 'Seules les contributions en transit peuvent etre recues', 400)
  }

  const nextLocation = myRole === 'TRESORIER' ? 'EN_CAISSE' : 'CHEZ_COLLECTEUR'

  const updated = await prisma.$transaction(async tx => {
    const result = await tx.contribution.updateMany({
      where: { id: { in: contributionIds } },
      data: { localisationFonds: nextLocation, collecteurId: myUserId },
    })

    await tx.auditLog.createMany({
      data: contributions.map(contribution => ({
        userId: myUserId,
        userName: req.user!.email,
        action: 'CLAIM',
        entityType: 'Contribution',
        entityId: contribution.id,
        details: {
          contributionId: contribution.id,
          toUserId: myUserId,
          toUserRole: myRole,
          toLocation: nextLocation,
          note,
          actorUserId: myUserId,
          actorUserRole: myRole,
        },
      })),
    })

    return result
  })

  res.json({ success: true, data: { updated: updated.count } })
})

export { router as collecteursRouter }

function amountFor(
  groups: Array<{ localisationFonds: string; _sum: { montant: number | null } }>,
  localisationFonds: string
) {
  return groups.find(item => item.localisationFonds === localisationFonds)?._sum.montant ?? 0
}
