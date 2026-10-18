import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel, ROLE_LEVELS } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { getPrisma } from '../lib/prisma'
import { refundsByRubrique } from '../services/refund.service'
import { audit } from '../services/audit.service'

const router = Router()
const prisma = getPrisma()

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

  // EF-M04-06 : total global réservé au niveau 3 et plus ; un collecteur voit ses
  // encaissements, un membre ses propres contributions
  const role = req.user!.role
  const scope: Prisma.ContributionWhereInput | null = (ROLE_LEVELS[role] ?? 0) >= 3 ? null
    : role === 'COLLECTEUR' ? { collecteurId: req.user!.userId }
    : { membre: { userId: req.user!.userId } }
  const totalScope = scope === null ? 'GLOBAL' : role === 'COLLECTEUR' ? 'COLLECTEUR' : 'MEMBRE'

  const refunded = await refundsByRubrique(undefined, scope ? { contribution: scope } : {})
  const enriched = await Promise.all(rubriques.map(async ({ _count, ...r }) => {
    const agg = await prisma.contribution.aggregate({
      where: { rubriqueId: r.id, statut: 'CONFIRME', ...scope },
      _sum: { montant: true },
      _count: true
    })
    // Net des remboursements exécutés
    return {
      ...r, ...(scope === null && { _count }), totalScope,
      totalCollecte: (agg._sum.montant ?? 0) - (refunded.get(r.id) ?? 0), nbContributions: agg._count,
    }
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

// POST /api/rubriques/:id/reconduire — reconduction N → N+1 (EF-M04-03) :
// mêmes caractéristiques, montants revalorisés de defaultIncreaseRate %
// (arrondis à la centaine), dates décalées d'un an ; la rubrique d'origine est inchangée
const RENEW_ROUNDING = 100
const renewSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100).optional(),
  increaseRate: z.number().min(0).max(100).optional(),
  code: z.string().trim().min(2).max(40).optional(),
})

router.post('/:id/reconduire', authenticate, requireLevel(3), async (req, res) => {
  const body = renewSchema.parse(req.body)
  const source = await prisma.rubrique.findUnique({ where: { id: String(req.params.id) }, include: { collectePublique: { select: { id: true } } } })
  if (!source) throw new AppError('NOT_FOUND', 'Rubrique introuvable', 404)
  if (source.collectePublique) throw new AppError('BUSINESS_RULE', 'Une collecte publique ne se reconduit pas.', 400)
  const settings = await prisma.systemSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } })

  const year = body.fiscalYear ?? source.fiscalYear + 1
  const rate = body.increaseRate ?? settings.defaultIncreaseRate
  const yearShift = year - source.fiscalYear
  const code = body.code ?? (source.code.includes(String(source.fiscalYear))
    ? source.code.replace(String(source.fiscalYear), String(year))
    : `${source.code}-${year}`)
  if (await prisma.rubrique.findUnique({ where: { code } })) {
    throw new AppError('DUPLICATE', `Le code ${code} existe déjà : la rubrique a peut-être déjà été reconduite.`, 409, 'code')
  }
  const revalue = (v: number | null) => v === null ? null : Math.max(RENEW_ROUNDING, Math.round(v * (1 + rate / 100) / RENEW_ROUNDING) * RENEW_ROUNDING)
  const shift = (d: Date | null) => { if (!d) return null; const n = new Date(d); n.setFullYear(n.getFullYear() + yearShift); return n }

  const rubrique = await prisma.rubrique.create({
    data: {
      code, title: source.title.includes(String(source.fiscalYear)) ? source.title.replace(String(source.fiscalYear), String(year)) : source.title,
      description: source.description, type: source.type, priority: source.priority, status: 'OUVERTE', fiscalYear: year,
      openDate: shift(source.openDate)!, closeDate: shift(source.closeDate),
      amountTravailleur: revalue(source.amountTravailleur), amountEtudiant: revalue(source.amountEtudiant), amountCouple: revalue(source.amountCouple),
      targetAmount: revalue(source.targetAmount), targetAll: source.targetAll, personnesConcernees: source.personnesConcernees,
      isAnnualReference: source.isAnnualReference,
      createdById: req.user!.userId, createdByName: req.user!.email,
    },
  })
  await audit({
    req, userId: req.user!.userId, userName: req.user!.email, action: 'CREATE', entityType: 'Rubrique', entityId: rubrique.id,
    details: { code, reconduiteDe: source.code, revalorisation: rate },
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
