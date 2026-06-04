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
  localisationFonds: z.enum(['CAISSE_PRINCIPALE', 'BANQUE']),
  note: z.string().max(500).optional(),
})

router.get('/', authenticate, requireLevel(3), async (_req, res) => {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } })
  const maxRetentionDays = settings?.maxFundsRetentionDays ?? 7
  const retentionLimit = new Date(Date.now() - maxRetentionDays * 24 * 60 * 60 * 1000)

  const contributions = await prisma.contribution.findMany({
    where: {
      statut: 'CONFIRME',
      localisationFonds: { in: ['CHEZ_COLLECTEUR', 'EN_TRANSIT'] },
    },
    include: {
      collecteur: { select: { id: true, fullName: true, email: true, role: true } },
      membre: { include: { user: { select: { fullName: true } } } },
      rubrique: { select: { code: true, title: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

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
      }
    }
  })
})

router.patch('/transfer', authenticate, requireLevel(3), async (req, res) => {
  const data = transferSchema.parse(req.body)

  const contributions = await prisma.contribution.findMany({
    where: { id: { in: data.contributionIds } },
    select: { id: true, statut: true, localisationFonds: true, montant: true },
  })

  if (contributions.length !== data.contributionIds.length) {
    throw new AppError('NOT_FOUND', 'Une ou plusieurs contributions sont introuvables', 404)
  }

  const invalid = contributions.find(c =>
    c.statut !== 'CONFIRME' ||
    !['CHEZ_COLLECTEUR', 'EN_TRANSIT'].includes(c.localisationFonds)
  )
  if (invalid) {
    throw new AppError('BUSINESS_RULE', 'Seules les contributions confirmees non reversees peuvent etre transferees')
  }

  const updated = await prisma.$transaction(async tx => {
    const result = await tx.contribution.updateMany({
      where: { id: { in: data.contributionIds } },
      data: { localisationFonds: data.localisationFonds }
    })

    await tx.auditLog.create({
      data: {
        userId: req.user!.userId,
        userName: req.user!.email,
        action: 'TRANSFER',
        entityType: 'Contribution',
        details: {
          contributionIds: data.contributionIds,
          localisationFonds: data.localisationFonds,
          total: contributions.reduce((sum, c) => sum + c.montant, 0),
          note: data.note,
        },
      }
    })

    return result
  })

  res.json({ success: true, data: { updated: updated.count } })
})

export { router as collecteursRouter }
