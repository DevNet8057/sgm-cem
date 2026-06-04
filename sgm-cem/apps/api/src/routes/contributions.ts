import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'

const router = Router()
const prisma = new PrismaClient()

const createSchema = z.object({
  membreId: z.string(),
  rubriqueId: z.string(),
  collecteurId: z.string().optional(),
  montant: z.number().int().positive(),
  modePaiement: z.enum(['ESPECES', 'MTN_MOMO', 'ORANGE_MONEY', 'CARTE_VISA', 'VIREMENT']),
  periodeLabel: z.string().optional(),
  mobileMoneyPhone: z.string().optional(),
  referencePaiement: z.string().optional(),
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

router.post('/', authenticate, requireLevel(2), async (req, res) => {
  const data = createSchema.parse(req.body)

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

  const contribution = await prisma.contribution.create({
    data: {
      ...data,
      collecteurId: data.collecteurId ?? req.user!.userId,
      montantAttendu: montantAttendu ?? data.montant,
      statut: 'EN_ATTENTE_CONFIRMATION',
      localisationFonds: data.modePaiement === 'ESPECES' ? 'CHEZ_COLLECTEUR' : 'EN_TRANSIT',
    },
    include: {
      membre: { include: { user: { select: { fullName: true } } } },
      rubrique: { select: { title: true, code: true } },
      collecteur: { select: { fullName: true } },
    }
  })

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

  res.status(201).json({ success: true, data: contribution })
})

router.patch('/:id/confirm', authenticate, requireLevel(2), async (req, res) => {
  const id = String(req.params.id)
  const contribution = await prisma.contribution.findUnique({ where: { id } })
  if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  if (contribution.statut !== 'EN_ATTENTE_CONFIRMATION') {
    throw new AppError('BUSINESS_RULE', 'Cette contribution ne peut pas etre confirmee')
  }

  const updated = await prisma.contribution.update({
    where: { id },
    data: { statut: 'CONFIRME', confirmedAt: new Date(), confirmedById: req.user!.userId }
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

  res.json({ success: true, data: updated })
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

export { router as contributionsRouter }
