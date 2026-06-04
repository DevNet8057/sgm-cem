import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'

const router = Router()
const prisma = new PrismaClient()

router.get('/dashboard', authenticate, requireLevel(3), async (_req, res) => {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfYear = new Date(now.getFullYear(), 0, 1)

  const [
    totalMembres,
    membresEnRetard,
    pendingConfirmations,
    totalMonth,
    totalYear,
    recentContributions,
    rubriquesActives,
  ] = await Promise.all([
    prisma.membre.count({ where: { isActive: true } }),
    prisma.membre.count({ where: { statut: { in: ['EN_OBSERVATION', 'EN_SUIVI'] } } }),
    prisma.contribution.count({ where: { statut: 'EN_ATTENTE_CONFIRMATION' } }),
    prisma.contribution.aggregate({
      where: { statut: 'CONFIRME', createdAt: { gte: startOfMonth } },
      _sum: { montant: true }
    }),
    prisma.contribution.aggregate({
      where: { statut: 'CONFIRME', createdAt: { gte: startOfYear } },
      _sum: { montant: true }
    }),
    prisma.contribution.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        membre: { include: { user: { select: { fullName: true } } } },
        rubrique: { select: { title: true, code: true } }
      }
    }),
    prisma.rubrique.findMany({
      where: { status: 'OUVERTE' },
      include: { _count: { select: { contributions: true } } },
      orderBy: [{ priority: 'desc' }],
      take: 5
    })
  ])

  res.json({
    success: true,
    data: {
      totalMembres,
      membresEnRetard,
      pendingConfirmations,
      totalCollectedMonth: totalMonth._sum.montant ?? 0,
      totalCollectedYear: totalYear._sum.montant ?? 0,
      recentContributions,
      rubriquesActives,
    }
  })
})

router.get('/monthly', authenticate, requireLevel(3), async (req, res) => {
  const year = parseInt(req.query.year as string) || new Date().getFullYear()

  const monthly = await Promise.all(
    Array.from({ length: 12 }, (_, i) => i).map(async (month) => {
      const start = new Date(year, month, 1)
      const end = new Date(year, month + 1, 0)
      const agg = await prisma.contribution.aggregate({
        where: { statut: 'CONFIRME', createdAt: { gte: start, lte: end } },
        _sum: { montant: true },
        _count: true
      })
      return {
        month: month + 1,
        label: new Date(year, month).toLocaleDateString('fr-FR', { month: 'short' }),
        total: agg._sum.montant ?? 0,
        count: agg._count
      }
    })
  )

  res.json({ success: true, data: monthly })
})

export { router as statsRouter }
