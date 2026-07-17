// ──────────────────────────────────────────────────────────────────────
// COLLECTES PUBLIQUES (côté back-office) — création, édition, suivi des
// contributions d'un lien de collecte exposé au public.
// Le formulaire public lui-même (sans authentification) vit ailleurs ;
// ces routes sont réservées à la gestion interne (ADMIN/TRESORIER+).
// ──────────────────────────────────────────────────────────────────────
import crypto from 'crypto'
import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient, Prisma } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireRole, requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { generatePublicSlug } from '../services/collecte.service'

const router = Router()
const prisma = new PrismaClient()

const champPersonnaliseSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,29}$/, 'Clé de champ invalide'),
  label: z.string().min(1),
  type: z.enum(['text', 'number', 'select', 'date', 'checkbox']),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
}).superRefine((champ, ctx) => {
  if (champ.type === 'select' && (!champ.options || champ.options.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Les options sont requises pour un champ de type select',
      path: ['options'],
    })
  }
})

const champsPersonnalisesSchema = z.array(champPersonnaliseSchema).max(12)
  .refine(
    champs => new Set(champs.map(c => c.key)).size === champs.length,
    { message: 'Les clés des champs personnalisés doivent être uniques' }
  )

const createSchema = z.object({
  titre: z.string().min(3),
  description: z.string().optional(),
  rubriqueId: z.string().optional(),
  montantMin: z.number().int().positive().optional(),
  montantsSuggeres: z.array(z.number().int().positive()).max(6).optional(),
  champsPersonnalises: champsPersonnalisesSchema,
})

const updateSchema = z.object({
  titre: z.string().min(3).optional(),
  description: z.string().optional(),
  montantMin: z.number().int().positive().optional(),
  montantsSuggeres: z.array(z.number().int().positive()).max(6).optional(),
  isActive: z.boolean().optional(),
  champsPersonnalises: champsPersonnalisesSchema.optional(),
})

/** Code de rubrique auto-généré pour les collectes créées sans rubrique existante. */
async function generateRubriqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = crypto.randomBytes(3).toString('hex').toUpperCase()
    const code = `COL-${new Date().getFullYear()}-${suffix}`
    const existing = await prisma.rubrique.findUnique({ where: { code } })
    if (!existing) return code
  }
  throw new AppError('SERVER_ERROR', 'Impossible de générer un code de rubrique unique', 500)
}

// POST /api/collectes - Créer une collecte publique (avec ou sans rubrique existante)
router.post('/', authenticate, requireRole('ADMIN', 'TRESORIER', 'DEVELOPER'), async (req, res) => {
  const data = createSchema.parse(req.body)

  let rubriqueId = data.rubriqueId
  if (rubriqueId) {
    const rubrique = await prisma.rubrique.findUnique({
      where: { id: rubriqueId },
      include: { collectePublique: true },
    })
    if (!rubrique) throw new AppError('NOT_FOUND', 'Rubrique introuvable', 404)
    if (rubrique.status !== 'OUVERTE') throw new AppError('BUSINESS_RULE', 'La rubrique doit être ouverte pour y attacher une collecte')
    if (rubrique.collectePublique) throw new AppError('CONFLICT', 'Cette rubrique a déjà une collecte publique', 409)
  }

  const collecte = await prisma.$transaction(async (tx) => {
    if (!rubriqueId) {
      const code = await generateRubriqueCode()
      const rubrique = await tx.rubrique.create({
        data: {
          code,
          title: data.titre,
          type: 'PONCTUELLE',
          status: 'OUVERTE',
          fiscalYear: new Date().getFullYear(),
          openDate: new Date(),
          createdById: req.user!.userId,
          createdByName: req.user!.email,
        },
      })
      rubriqueId = rubrique.id
    }

    const created = await tx.collectePublique.create({
      data: {
        rubriqueId,
        publicSlug: generatePublicSlug(data.titre),
        titre: data.titre,
        description: data.description,
        champsPersonnalises: data.champsPersonnalises,
        montantMin: data.montantMin,
        montantsSuggeres: data.montantsSuggeres ?? [],
        createdById: req.user!.userId,
        createdByName: req.user!.email,
      },
      include: { rubrique: { select: { code: true, title: true, targetAmount: true } } },
    })

    await tx.auditLog.create({
      data: {
        userId: req.user!.userId,
        userName: req.user!.email,
        action: 'CREATE',
        entityType: 'CollectePublique',
        entityId: created.id,
        details: { titre: created.titre, publicSlug: created.publicSlug, rubriqueId: created.rubriqueId },
      },
    })

    return created
  })

  res.status(201).json({ success: true, data: collecte })
})

// GET /api/collectes - Liste des collectes publiques (lecture trésorier+)
router.get('/', authenticate, requireLevel(4), async (_req, res) => {
  const collectes = await prisma.collectePublique.findMany({
    include: {
      rubrique: { select: { code: true, title: true, targetAmount: true } },
      _count: { select: { drafts: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const enriched = await Promise.all(collectes.map(async c => {
    const [agg, draftsActifs] = await Promise.all([
      prisma.contribution.aggregate({
        where: { rubriqueId: c.rubriqueId, statut: 'CONFIRME' },
        _sum: { montant: true },
        _count: true,
      }),
      prisma.collecteDraft.count({ where: { collecteId: c.id, statut: 'ACTIF' } }),
    ])
    return {
      ...c,
      totalCollecte: agg._sum.montant ?? 0,
      nbContributions: agg._count,
      nbDraftsActifs: draftsActifs,
    }
  }))

  res.json({ success: true, data: enriched })
})

// PATCH /api/collectes/:id - Mettre à jour une collecte publique
router.patch('/:id', authenticate, requireRole('ADMIN', 'TRESORIER', 'DEVELOPER'), async (req, res) => {
  const data = updateSchema.parse(req.body)
  const id = String(req.params.id)

  const current = await prisma.collectePublique.findUnique({ where: { id } })
  if (!current) throw new AppError('NOT_FOUND', 'Collecte introuvable', 404)

  const collecte = await prisma.collectePublique.update({
    where: { id },
    data: {
      ...data,
      champsPersonnalises: data.champsPersonnalises ?? undefined,
    },
    include: { rubrique: { select: { code: true, title: true, targetAmount: true } } },
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'UPDATE',
      entityType: 'CollectePublique',
      entityId: collecte.id,
      details: data,
    },
  })

  res.json({ success: true, data: collecte })
})

// GET /api/collectes/:id/contributions - Contributions liées à la collecte (lecture trésorier+)
router.get('/:id/contributions', authenticate, requireLevel(4), async (req, res) => {
  const id = String(req.params.id)
  const { page = '1', limit = '20' } = req.query as Record<string, string>
  const currentPage = Math.max(1, parseInt(page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
  const skip = (currentPage - 1) * pageSize

  const collecte = await prisma.collectePublique.findUnique({ where: { id } })
  if (!collecte) throw new AppError('NOT_FOUND', 'Collecte introuvable', 404)

  const where: Prisma.ContributionWhereInput = {
    rubriqueId: collecte.rubriqueId,
    statut: { in: ['CONFIRME', 'EN_ATTENTE_CONFIRMATION'] },
  }

  const [contributions, total, agg] = await Promise.all([
    prisma.contribution.findMany({
      where,
      skip,
      take: pageSize,
      include: {
        membre: { include: { user: { select: { fullName: true } } } },
        contributeurExterne: { select: { nom: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.contribution.count({ where }),
    prisma.contribution.aggregate({
      where: { rubriqueId: collecte.rubriqueId, statut: 'CONFIRME' },
      _sum: { montant: true },
      _count: true,
    }),
  ])

  const rows = contributions.map(c => ({
    id: c.id,
    date: c.createdAt,
    nom: c.membre?.user.fullName ?? c.contributeurExterne?.nom ?? 'Inconnu',
    type: c.membre ? 'MEMBRE' : 'EXTERNE',
    phone: c.contributeurExterne?.phone ?? null,
    montant: c.montant,
    statut: c.statut,
    modePaiement: c.modePaiement,
    valeursChamps: c.valeursChamps,
  }))

  res.json({
    success: true,
    data: rows,
    pagination: { page: currentPage, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) },
    totaux: { montantConfirme: agg._sum.montant ?? 0, nbConfirmees: agg._count },
  })
})

export { router as collectesRouter }
