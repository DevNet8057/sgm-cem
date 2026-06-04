import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'

const router = Router()
const prisma = new PrismaClient()

const createSchema = z.object({
  code: z.string().min(2),
  title: z.string().min(3),
  description: z.string().optional(),
  type: z.enum(['REGULIERE_MENSUELLE', 'PONCTUELLE', 'URGENTE']),
  priority: z.enum(['NORMAL', 'PRIORITAIRE', 'URGENT']).default('NORMAL'),
  fiscalYear: z.number().int(),
  openDate: z.string().datetime(),
  closeDate: z.string().datetime().optional(),
  amountTravailleur: z.number().int().positive().optional(),
  amountEtudiant: z.number().int().positive().optional(),
  amountCouple: z.number().int().positive().optional(),
  targetAmount: z.number().int().positive().optional(),
  targetAll: z.boolean().default(false),
  personnesConcernees: z.string().optional(),
})

const updateSchema = createSchema.partial()

router.get('/', authenticate, requireLevel(1), async (req, res) => {
  const { status, fiscalYear } = req.query as Record<string, string>

  const rubriques = await prisma.rubrique.findMany({
    where: {
      ...(status && { status: status as never }),
      ...(fiscalYear && { fiscalYear: parseInt(fiscalYear) }),
    },
    include: { _count: { select: { contributions: true } } },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
  })

  const enriched = await Promise.all(rubriques.map(async r => {
    const agg = await prisma.contribution.aggregate({
      where: { rubriqueId: r.id, statut: 'CONFIRME' },
      _sum: { montant: true },
      _count: true
    })
    return { ...r, totalCollecte: agg._sum.montant ?? 0, nbContributions: agg._count }
  }))

  res.json({ success: true, data: enriched })
})

router.post('/', authenticate, requireLevel(3), async (req, res) => {
  const data = createSchema.parse(req.body)
  const existing = await prisma.rubrique.findUnique({ where: { code: data.code } })
  if (existing) throw new AppError('DUPLICATE', 'Ce code de rubrique existe déjà')

  const rubrique = await prisma.rubrique.create({
    data: {
      ...data,
      openDate: new Date(data.openDate),
      closeDate: data.closeDate ? new Date(data.closeDate) : undefined,
      createdById: req.user!.userId,
      createdByName: req.user!.email,
    }
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'CREATE',
      entityType: 'Rubrique',
      entityId: rubrique.id,
      details: { code: rubrique.code, title: rubrique.title },
    }
  })

  res.status(201).json({ success: true, data: rubrique })
})

router.patch('/:id', authenticate, requireLevel(3), async (req, res) => {
  const data = updateSchema.parse(req.body)
  const id = String(req.params.id)
  const current = await prisma.rubrique.findUnique({ where: { id } })
  if (!current) throw new AppError('NOT_FOUND', 'Rubrique introuvable', 404)

  if (data.code && data.code !== current.code) {
    const existing = await prisma.rubrique.findUnique({ where: { code: data.code } })
    if (existing) throw new AppError('DUPLICATE', 'Ce code de rubrique existe deja')
  }

  const rubrique = await prisma.rubrique.update({
    where: { id },
    data: {
      ...data,
      openDate: data.openDate ? new Date(data.openDate) : undefined,
      closeDate: data.closeDate ? new Date(data.closeDate) : undefined,
    }
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'UPDATE',
      entityType: 'Rubrique',
      entityId: rubrique.id,
      details: data,
    }
  })

  res.json({ success: true, data: rubrique })
})

router.patch('/:id/status', authenticate, requireLevel(3), async (req, res) => {
  const { status } = z.object({ status: z.enum(['OUVERTE', 'FERMEE', 'ARCHIVEE']) }).parse(req.body)
  const rubrique = await prisma.rubrique.update({
    where: { id: String(req.params.id) },
    data: {
      status,
      closeDate: status === 'FERMEE' || status === 'ARCHIVEE' ? new Date() : null,
    }
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'UPDATE',
      entityType: 'Rubrique',
      entityId: rubrique.id,
      details: { status },
    }
  })

  res.json({ success: true, data: rubrique })
})

export { router as rubriquesRouter }
