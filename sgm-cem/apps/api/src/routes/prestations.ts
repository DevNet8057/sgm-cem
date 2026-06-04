import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'

const router = Router()
const prisma = new PrismaClient()

const createSchema = z.object({
  titre: z.string().min(3).max(160),
  description: z.string().max(800).optional(),
  commanditaire: z.string().min(2).max(120),
  commanditairePhone: z.string().max(40).optional(),
  tarifBase: z.number().int().min(0),
  rabaisCommanditaire: z.number().int().min(0).default(0),
  commissionPercent: z.number().min(0).max(100).default(35),
  dateEvenement: z.string().datetime().optional(),
  lieu: z.string().max(160).optional(),
  notes: z.string().max(1000).optional(),
})

const coursSchema = z.object({
  libelle: z.string().min(2).max(140),
  montant: z.number().int().positive(),
  justificatif: z.string().max(240).optional(),
})

const entreeSchema = z.object({
  libelle: z.string().min(2).max(140),
  montant: z.number().int().positive(),
  modePaiement: z.enum(['ESPECES', 'MTN_MOMO', 'ORANGE_MONEY', 'CARTE_VISA', 'VIREMENT']),
  reference: z.string().max(120).optional(),
})

router.get('/', authenticate, requireLevel(2), async (_req, res) => {
  const prestations = await prisma.prestation.findMany({
    orderBy: { createdAt: 'desc' },
  })
  res.json({ success: true, data: prestations })
})

router.get('/:id', authenticate, requireLevel(2), async (req, res) => {
  const prestation = await findPrestation(String(req.params.id))
  res.json({ success: true, data: prestation })
})

router.post('/', authenticate, requireLevel(3), async (req, res) => {
  const data = createSchema.parse(req.body)
  const tarifFinal = Math.max(0, data.tarifBase - data.rabaisCommanditaire)
  const rabaisPercent = data.tarifBase > 0 ? Math.round((data.rabaisCommanditaire / data.tarifBase) * 10000) / 100 : 0
  const reference = await nextReference()

  const prestation = await prisma.prestation.create({
    data: {
      ...data,
      reference,
      tarifFinal,
      rabaisPercent,
      solde: tarifFinal,
      dateEvenement: data.dateEvenement ? new Date(data.dateEvenement) : undefined,
    },
  })

  await audit(req.user!.userId, req.user!.email, 'CREATE', prestation.id, { reference, tarifFinal })
  res.status(201).json({ success: true, data: prestation })
})

router.post('/:id/cours', authenticate, requireLevel(3), async (req, res) => {
  const id = String(req.params.id)
  const data = coursSchema.parse(req.body)
  const prestation = await prisma.prestation.findUnique({ where: { id } })
  if (!prestation) throw new AppError('NOT_FOUND', 'Prestation introuvable', 404)
  if (['COMMISSION_VERSEE', 'CLOTURE'].includes(prestation.statut)) {
    throw new AppError('BUSINESS_RULE', 'Cette prestation ne peut plus recevoir de cours')
  }

  await prisma.coursPrestation.create({ data: { prestationId: id, ...data } })
  const updated = await recomputePrestation(id)
  await audit(req.user!.userId, req.user!.email, 'CREATE', id, { cours: data })
  res.status(201).json({ success: true, data: updated })
})

router.post('/:id/entrees', authenticate, requireLevel(3), async (req, res) => {
  const id = String(req.params.id)
  const data = entreeSchema.parse(req.body)
  const prestation = await prisma.prestation.findUnique({ where: { id } })
  if (!prestation) throw new AppError('NOT_FOUND', 'Prestation introuvable', 404)
  if (['ENTREES_COMPLETES', 'COMMISSION_VERSEE', 'CLOTURE'].includes(prestation.statut)) {
    throw new AppError('BUSINESS_RULE', 'Les entrees sont deja cloturees')
  }

  await prisma.entreePrestation.create({ data: { prestationId: id, ...data } })
  const updated = await recomputePrestation(id)
  await audit(req.user!.userId, req.user!.email, 'CREATE', id, { entree: data })
  res.status(201).json({ success: true, data: updated })
})

router.patch('/:id/close-entrees', authenticate, requireLevel(3), async (req, res) => {
  const id = String(req.params.id)
  const prestation = await prisma.prestation.findUnique({ where: { id } })
  if (!prestation) throw new AppError('NOT_FOUND', 'Prestation introuvable', 404)
  if (prestation.totalEntrees < prestation.tarifFinal) {
    throw new AppError('BUSINESS_RULE', 'Les entrees ne couvrent pas encore le tarif final')
  }

  const updated = await prisma.prestation.update({
    where: { id },
    data: { statut: 'ENTREES_COMPLETES' },
    include: { cours: true, entrees: true },
  })
  await audit(req.user!.userId, req.user!.email, 'APPROVE', id, { statut: updated.statut })
  res.json({ success: true, data: updated })
})

router.patch('/:id/pay-commission', authenticate, requireLevel(4), async (req, res) => {
  const id = String(req.params.id)
  const prestation = await prisma.prestation.findUnique({ where: { id } })
  if (!prestation) throw new AppError('NOT_FOUND', 'Prestation introuvable', 404)
  if (prestation.statut !== 'ENTREES_COMPLETES') {
    throw new AppError('BUSINESS_RULE', 'La commission est possible uniquement apres cloture des entrees')
  }

  const baseCommission = Math.max(0, prestation.tarifFinal - prestation.totalCours)
  const commission = Math.round(baseCommission * (prestation.commissionPercent / 100))
  const updated = await prisma.prestation.update({
    where: { id },
    data: { commission, statut: 'COMMISSION_VERSEE', commissionVerseeAt: new Date() },
    include: { cours: true, entrees: true },
  })
  await audit(req.user!.userId, req.user!.email, 'TRANSFER', id, { commission })
  res.json({ success: true, data: updated })
})

async function findPrestation(id: string) {
  const prestation = await prisma.prestation.findUnique({
    where: { id },
    include: { cours: true, entrees: true },
  })
  if (!prestation) throw new AppError('NOT_FOUND', 'Prestation introuvable', 404)
  return prestation
}

async function recomputePrestation(id: string) {
  const [cours, entrees, prestation] = await Promise.all([
    prisma.coursPrestation.aggregate({ where: { prestationId: id }, _sum: { montant: true } }),
    prisma.entreePrestation.aggregate({ where: { prestationId: id }, _sum: { montant: true } }),
    prisma.prestation.findUnique({ where: { id } }),
  ])
  if (!prestation) throw new AppError('NOT_FOUND', 'Prestation introuvable', 404)

  const totalCours = cours._sum.montant ?? 0
  const totalEntrees = entrees._sum.montant ?? 0
  const solde = Math.max(0, prestation.tarifFinal - totalEntrees)
  const acompte = Math.min(totalEntrees, prestation.tarifFinal)
  const statut = prestation.statut === 'EN_PREPARATION' && (totalCours > 0 || totalEntrees > 0) ? 'EN_COURS' : prestation.statut

  return prisma.prestation.update({
    where: { id },
    data: { totalCours, totalEntrees, solde, acompte, statut },
    include: { cours: true, entrees: true },
  })
}

async function nextReference() {
  const year = new Date().getFullYear()
  const count = await prisma.prestation.count({
    where: { createdAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
  })
  return `PREST-${year}-${String(count + 1).padStart(4, '0')}`
}

async function audit(userId: string, userName: string, action: 'CREATE' | 'APPROVE' | 'TRANSFER', entityId: string, details: object) {
  await prisma.auditLog.create({
    data: { userId, userName, action, entityType: 'Prestation', entityId, details },
  })
}

export { router as prestationsRouter }
