import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { generateFinancialReportPdf } from '../services/financial-report'

const router = Router()
const prisma = new PrismaClient()

export async function computeDashboardStats(requestedYear?: number) {
  const now = new Date()
  const year = requestedYear || now.getFullYear()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfYear = new Date(year, 0, 1)
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999)

  const [
    totalMembres,
    membresEnRetard,
    pendingConfirmations,
    litiges,
    totalMonth,
    totalYear,
    recentContributions,
    rubriquesOuvertes,
    confirmedContributions,
    allYearContributions,
  ] = await Promise.all([
    prisma.membre.count({ where: { isActive: true } }),
    prisma.membre.count({ where: { statut: { in: ['EN_OBSERVATION', 'EN_SUIVI'] } } }),
    prisma.contribution.count({ where: { statut: 'EN_ATTENTE_CONFIRMATION' } }),
    prisma.contribution.count({ where: { statut: 'LITIGE' } }),
    prisma.contribution.aggregate({
      where: { statut: 'CONFIRME', createdAt: { gte: startOfMonth } },
      _sum: { montant: true }
    }),
    prisma.contribution.aggregate({
      where: { statut: 'CONFIRME', createdAt: { gte: startOfYear, lte: endOfYear } },
      _sum: { montant: true },
      _count: true,
    }),
    prisma.contribution.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        membre: { include: { user: { select: { fullName: true } } } },
        rubrique: { select: { title: true, code: true } },
        collecteur: { select: { fullName: true } },
      }
    }),
    prisma.rubrique.findMany({
      where: { status: 'OUVERTE' },
      include: { _count: { select: { contributions: true } } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 8
    }),
    prisma.contribution.findMany({
      where: { statut: 'CONFIRME', createdAt: { gte: startOfYear, lte: endOfYear } },
      include: {
        membre: { include: { user: { select: { fullName: true } } } },
        rubrique: { select: { id: true, code: true, title: true, targetAmount: true } },
      }
    }),
    prisma.contribution.findMany({
      where: { createdAt: { gte: startOfYear, lte: endOfYear } },
      select: { statut: true },
    }),
  ])

  const rubriquesActives = await Promise.all(rubriquesOuvertes.map(async rubrique => {
    const agg = await prisma.contribution.aggregate({
      where: { rubriqueId: rubrique.id, statut: 'CONFIRME' },
      _sum: { montant: true },
      _count: true,
    })
    return {
      ...rubrique,
      totalCollecte: agg._sum.montant ?? 0,
      nbContributions: agg._count,
    }
  }))

  const topContributorsMap = new Map<string, { membreId: string; fullName: string; total: number; count: number }>()
  const modeMap = new Map<string, { modePaiement: string; total: number; count: number }>()
  const rubriqueMap = new Map<string, { rubriqueId: string; code: string; title: string; targetAmount?: number; total: number; count: number }>()

  for (const contribution of confirmedContributions) {
    const contributor = topContributorsMap.get(contribution.membreId) ?? {
      membreId: contribution.membreId,
      fullName: contribution.membre.user.fullName,
      total: 0,
      count: 0,
    }
    contributor.total += contribution.montant
    contributor.count += 1
    topContributorsMap.set(contribution.membreId, contributor)

    const mode = modeMap.get(contribution.modePaiement) ?? {
      modePaiement: contribution.modePaiement,
      total: 0,
      count: 0,
    }
    mode.total += contribution.montant
    mode.count += 1
    modeMap.set(contribution.modePaiement, mode)

    const rubrique = rubriqueMap.get(contribution.rubriqueId) ?? {
      rubriqueId: contribution.rubriqueId,
      code: contribution.rubrique.code,
      title: contribution.rubrique.title,
      targetAmount: contribution.rubrique.targetAmount ?? undefined,
      total: 0,
      count: 0,
    }
    rubrique.total += contribution.montant
    rubrique.count += 1
    rubriqueMap.set(contribution.rubriqueId, rubrique)
  }

  const topContributors = Array.from(topContributorsMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)

  const modePaiementStats = Array.from(modeMap.values())
    .map(item => ({
      ...item,
      share: confirmedContributions.length ? Math.round((item.count / confirmedContributions.length) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)

  const contributionRates = Array.from(rubriqueMap.values())
    .map(item => ({
      ...item,
      rate: item.targetAmount ? Math.round((item.total / item.targetAmount) * 100) : null,
    }))
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
    .slice(0, 8)

  const totalContributions = allYearContributions.length
  const confirmedCount = allYearContributions.filter(c => c.statut === 'CONFIRME').length
  const pendingCount = allYearContributions.filter(c => c.statut === 'EN_ATTENTE_CONFIRMATION').length
  const litigeCount = allYearContributions.filter(c => c.statut === 'LITIGE').length
  const globalConfirmationRate = totalContributions ? Math.round((confirmedCount / totalContributions) * 100) : 0

  return {
    year,
    totalMembres,
    membresEnRetard,
    pendingConfirmations,
    litiges,
    totalCollectedMonth: totalMonth._sum.montant ?? 0,
    totalCollectedYear: totalYear._sum.montant ?? 0,
    totalConfirmedContributions: totalYear._count,
    globalConfirmationRate,
    contributionStatus: {
      confirmed: confirmedCount,
      pending: pendingCount,
      litiges: litigeCount,
      total: totalContributions,
    },
    mostUsedPaymentMode: modePaiementStats[0] ?? null,
    topContributor: topContributors[0] ?? null,
    topContributors,
    modePaiementStats,
    contributionRates,
    recentContributions,
    rubriquesActives,
  }
}

router.get('/dashboard', authenticate, requireLevel(3), async (req, res) => {
  const year = parseInt(req.query.year as string) || undefined
  const data = await computeDashboardStats(year)
  res.json({ success: true, data })
})

/**
 * GET /api/stats/financial-report.pdf
 * Rapport financier annuel — PDF branché à la même identité visuelle que
 * les reçus et bordereaux. Remplace l'ancien flux popup + impression navigateur.
 */
router.get('/financial-report.pdf', authenticate, requireLevel(3), async (req, res) => {
  const year = parseInt(req.query.year as string) || undefined
  const pdf = await generateFinancialReportPdf(year)
  const disposition = req.query.download === '1' ? 'attachment' : 'inline'
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${disposition}; filename="Rapport-Financier-CEM-${year ?? new Date().getFullYear()}.pdf"`)
  res.send(pdf)
})

router.get('/monthly', authenticate, requireLevel(3), async (req, res) => {
  const year = parseInt(req.query.year as string) || new Date().getFullYear()

  const monthly = await Promise.all(
    Array.from({ length: 12 }, (_, i) => i).map(async (month) => {
      const start = new Date(year, month, 1)
      const end = new Date(year, month + 1, 0, 23, 59, 59, 999)
      const [confirmed, pending, litiges] = await Promise.all([
        prisma.contribution.aggregate({
          where: { statut: 'CONFIRME', createdAt: { gte: start, lte: end } },
          _sum: { montant: true },
          _count: true
        }),
        prisma.contribution.count({
          where: { statut: 'EN_ATTENTE_CONFIRMATION', createdAt: { gte: start, lte: end } }
        }),
        prisma.contribution.count({
          where: { statut: 'LITIGE', createdAt: { gte: start, lte: end } }
        }),
      ])

      const totalCount = confirmed._count + pending + litiges
      return {
        month: month + 1,
        label: new Date(year, month).toLocaleDateString('fr-FR', { month: 'short' }),
        total: confirmed._sum.montant ?? 0,
        count: confirmed._count,
        pending,
        litiges,
        confirmationRate: totalCount ? Math.round((confirmed._count / totalCount) * 100) : 0,
      }
    })
  )

  res.json({ success: true, data: monthly })
})

export { router as statsRouter }
