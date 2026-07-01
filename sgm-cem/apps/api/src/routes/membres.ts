import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'

const router = Router()
const prisma = new PrismaClient()

// ─── Schémas ─────────────────────────────────────────────────────────
const createSchema = z.object({
  firstName:       z.string().min(2),
  lastName:        z.string().min(2),
  email:           z.string().email(),
  phone:           z.string().optional(),
  categorie:       z.enum(['MCE_EN_SERVICE', 'ENFANTS', 'DIASPORA']),
  groupe:          z.enum(['TEMPLE', 'MVOG_BETSI', 'BISCUITERIE', 'OBILI', 'SCIENCES', 'POLYTECHNIQUE']),
  statut:          z.enum(['EN_OBSERVATION', 'EN_SUIVI', 'FIN_DE_SUIVI', 'DIASPORA']).default('EN_OBSERVATION'),
  profilFinancier: z.enum(['TRAVAILLEUR', 'ETUDIANT', 'COUPLE']).default('TRAVAILLEUR'),
  profession:      z.string().optional(),
  nomConjoint:     z.string().optional(),
  coupleMembreId:  z.string().optional(),
  password:        z.string().min(6).optional(),
})

const updateSchema = z.object({
  firstName:       z.string().min(2).optional(),
  lastName:        z.string().min(2).optional(),
  email:           z.string().email().optional(),
  phone:           z.string().optional(),
  adresse:         z.string().optional(),
  profession:      z.string().optional(),
  notes:           z.string().optional(),
  dateAdhesion:    z.string().datetime().optional(),
  dateNaissance:   z.string().datetime().optional(),
  categorie:       z.enum(['MCE_EN_SERVICE', 'ENFANTS', 'DIASPORA']).optional(),
  groupe:          z.enum(['TEMPLE', 'MVOG_BETSI', 'BISCUITERIE', 'OBILI', 'SCIENCES', 'POLYTECHNIQUE']).optional(),
  statut:          z.enum(['EN_OBSERVATION', 'EN_SUIVI', 'FIN_DE_SUIVI', 'DIASPORA']).optional(),
  profilFinancier: z.enum(['TRAVAILLEUR', 'ETUDIANT', 'COUPLE']).optional(),
  isActive:        z.boolean().optional(),
  nomConjoint:     z.string().optional().nullable(),
  coupleMembreId:  z.string().optional().nullable(),
})

const importSchema = z.object({
  membres: z.array(createSchema.omit({ password: true, coupleMembreId: true })).min(1).max(500),
})

async function nextMemberId(): Promise<string> {
  const count = await prisma.user.count()
  return `CEM-${new Date().getFullYear()}-${String(count + 1).padStart(6, '0')}`
}

async function nextMemberIds(count: number): Promise<string[]> {
  const start = await prisma.user.count()
  const year  = new Date().getFullYear()
  return Array.from({ length: count }, (_, i) =>
    `CEM-${year}-${String(start + i + 1).padStart(6, '0')}`
  )
}

// ─── Include helper ───────────────────────────────────────────────────
const MEMBRE_INCLUDE = {
  user:   { select: { fullName: true, email: true, role: true } },
  couple: { include: { user: { select: { fullName: true } } } },
} as const

// ─── GET /membres ─────────────────────────────────────────────────────
router.get('/', authenticate, requireLevel(2), async (req, res) => {
  const { page = '1', limit = '20', search, groupe, statut, profilFinancier } = req.query as Record<string, string>
  const skip = (parseInt(page) - 1) * parseInt(limit)

  const where = {
    isActive: true,
    ...(search && { user: { fullName: { contains: search, mode: 'insensitive' as const } } }),
    ...(groupe && { groupe: groupe as never }),
    ...(statut && { statut: statut as never }),
    ...(profilFinancier && { profilFinancier: profilFinancier as never }),
  }

  const [membres, total] = await Promise.all([
    prisma.membre.findMany({
      where, skip, take: parseInt(limit),
      include: MEMBRE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.membre.count({ where }),
  ])

  res.json({
    success: true,
    data: membres,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
  })
})

// ─── GET /membres/search (recherche pour lier un couple) ──────────────
router.get('/search', authenticate, requireLevel(2), async (req, res) => {
  const { q = '' } = req.query as Record<string, string>
  if (q.length < 2) { res.json({ success: true, data: [] }); return }

  const membres = await prisma.membre.findMany({
    where: {
      isActive: true,
      coupleId: null, // pas déjà en couple
      user: { fullName: { contains: q, mode: 'insensitive' } },
    },
    include: { user: { select: { fullName: true } } },
    take: 10,
  })

  res.json({ success: true, data: membres })
})

// ─── GET /membres/:id ─────────────────────────────────────────────────
router.get('/:id', authenticate, requireLevel(2), async (req, res) => {
  const membre = await prisma.membre.findUnique({
    where: { id: String(req.params.id) },
    include: {
      user: { select: { fullName: true, email: true, role: true } },
      couple: { include: { user: { select: { fullName: true } } } },
      contributions: { include: { rubrique: true }, orderBy: { createdAt: 'desc' }, take: 10 },
    },
  })
  if (!membre) res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Membre introuvable' } })
  else res.json({ success: true, data: membre })
})

// ─── POST /membres ────────────────────────────────────────────────────
router.post('/', authenticate, requireLevel(3), async (req, res) => {
  const data = createSchema.parse(req.body)
  const existing = await prisma.user.findUnique({ where: { email: data.email } })
  if (existing) throw new AppError('DUPLICATE', 'Cette adresse email existe déjà')

  const memberId   = await nextMemberId()
  const fullName   = `${data.firstName} ${data.lastName}`
  const passwordHash = await bcrypt.hash(data.password ?? 'ChristEst!2026', 12)

  // Vérifier le couple si fourni
  if (data.coupleMembreId) {
    const conjoint = await prisma.membre.findUnique({ where: { id: data.coupleMembreId } })
    if (!conjoint) throw new AppError('NOT_FOUND', 'Membre conjoint introuvable', 404)
  }

  const membre = await prisma.$transaction(async tx => {
    const user = await tx.user.create({
      data: {
        memberId, firstName: data.firstName, lastName: data.lastName,
        fullName, email: data.email, phone: data.phone,
        passwordHash, role: 'MEMBRE', isActive: true,
      },
    })

    const m = await tx.membre.create({
      data: {
        userId: user.id, memberId,
        categorie: data.categorie, groupe: data.groupe,
        statut: data.statut, profilFinancier: data.profilFinancier,
        phone: data.phone, email: data.email, profession: data.profession,
        nomConjoint: data.coupleMembreId ? undefined : data.nomConjoint,
        coupleId: data.coupleMembreId ?? undefined,
      },
      include: MEMBRE_INCLUDE,
    })

    // Liaison bidirectionnelle
    if (data.coupleMembreId) {
      await tx.membre.update({
        where: { id: data.coupleMembreId },
        data: { coupleId: m.id, profilFinancier: 'COUPLE' },
      })
    }

    return m
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId, userName: req.user!.email,
      action: 'CREATE', entityType: 'Membre', entityId: membre.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      details: { memberId: membre.memberId, fullName } as any,
    },
  })

  res.status(201).json({ success: true, data: membre })
})

// ─── PATCH /membres/:id ───────────────────────────────────────────────
router.patch('/:id', authenticate, requireLevel(3), async (req, res) => {
  const id      = String(req.params.id)
  const data    = updateSchema.parse(req.body)
  const current = await prisma.membre.findUnique({ where: { id }, include: { user: true } })
  if (!current) throw new AppError('NOT_FOUND', 'Membre introuvable', 404)

  if (data.email && data.email !== current.user.email) {
    const dup = await prisma.user.findUnique({ where: { email: data.email } })
    if (dup) throw new AppError('DUPLICATE', 'Cette adresse email existe déjà')
  }

  const firstName = data.firstName ?? current.user.firstName
  const lastName  = data.lastName  ?? current.user.lastName
  const fullName  = `${firstName} ${lastName}`

  // Gérer la liaison/déliaison couple
  let newCoupleId = data.coupleMembreId

  if (data.coupleMembreId !== undefined) {
    // Délier l'ancien couple
    if (current.coupleId) {
      await prisma.membre.update({
        where: { id: current.coupleId },
        data: { coupleId: null },
      })
    }
    // Lier le nouveau couple
    if (data.coupleMembreId) {
      const conjoint = await prisma.membre.findUnique({ where: { id: data.coupleMembreId } })
      if (!conjoint) throw new AppError('NOT_FOUND', 'Conjoint introuvable', 404)
      // Délier l'ancien couple du conjoint si nécessaire
      if (conjoint.coupleId && conjoint.coupleId !== id) {
        await prisma.membre.update({ where: { id: conjoint.coupleId }, data: { coupleId: null } })
      }
      await prisma.membre.update({
        where: { id: data.coupleMembreId },
        data: { coupleId: id, profilFinancier: 'COUPLE' },
      })
      newCoupleId = data.coupleMembreId
    }
  }

  const membre = await prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id: current.userId },
      data: { firstName, lastName, fullName, email: data.email, phone: data.phone, isActive: data.isActive },
    })

    return tx.membre.update({
      where: { id },
      data: {
        categorie:       data.categorie,
        groupe:          data.groupe,
        statut:          data.statut,
        profilFinancier: data.profilFinancier,
        phone:           data.phone,
        email:           data.email,
        adresse:         data.adresse,
        profession:      data.profession,
        notes:           data.notes,
        isActive:        data.isActive,
        dateAdhesion:    data.dateAdhesion ? new Date(data.dateAdhesion) : undefined,
        dateNaissance:   data.dateNaissance ? new Date(data.dateNaissance) : undefined,
        nomConjoint:     data.coupleMembreId ? null : data.nomConjoint,
        coupleId:        newCoupleId,
      },
      include: MEMBRE_INCLUDE,
    })
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId, userName: req.user!.email,
      action: 'UPDATE', entityType: 'Membre', entityId: membre.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      details: data as any,
    },
  })

  res.json({ success: true, data: membre })
})

// ─── DELETE /membres/:id/couple (délier un couple) ───────────────────
router.delete('/:id/couple', authenticate, requireLevel(3), async (req, res) => {
  const id     = String(req.params.id)
  const membre = await prisma.membre.findUnique({ where: { id } })
  if (!membre) throw new AppError('NOT_FOUND', 'Membre introuvable', 404)

  if (membre.coupleId) {
    await prisma.membre.update({ where: { id: membre.coupleId }, data: { coupleId: null } })
  }
  await prisma.membre.update({ where: { id }, data: { coupleId: null } })

  res.json({ success: true, message: 'Lien couple supprimé' })
})

// ─── PATCH /membres/:id/status ────────────────────────────────────────
router.patch('/:id/status', authenticate, requireLevel(3), async (req, res) => {
  const { statut } = z.object({
    statut: z.enum(['EN_OBSERVATION', 'EN_SUIVI', 'FIN_DE_SUIVI', 'DIASPORA']),
  }).parse(req.body)

  const membre = await prisma.membre.update({
    where: { id: String(req.params.id) },
    data: { statut },
    include: { user: { select: { fullName: true, email: true, role: true } } },
  })

  res.json({ success: true, data: membre })
})

// ─── POST /membres/import ─────────────────────────────────────────────
router.post('/import', authenticate, requireLevel(3), async (req, res) => {
  const { membres } = importSchema.parse(req.body)
  const emails = membres.map(m => m.email)
  const dupInput = emails.find((e, i) => emails.indexOf(e) !== i)
  if (dupInput) throw new AppError('DUPLICATE', `Email en double: ${dupInput}`)

  const existing = await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } })
  if (existing.length) throw new AppError('DUPLICATE', `Email déjà existant: ${existing[0].email}`)

  const memberIds  = await nextMemberIds(membres.length)
  const passwordHash = await bcrypt.hash('ChristEst!2026', 12)

  const created = await prisma.$transaction(async tx => {
    const rows = []
    for (const [index, item] of membres.entries()) {
      const memberId = memberIds[index]
      const fullName = `${item.firstName} ${item.lastName}`
      const user = await tx.user.create({
        data: {
          memberId, firstName: item.firstName, lastName: item.lastName,
          fullName, email: item.email, phone: item.phone,
          passwordHash, role: 'MEMBRE', isActive: true,
        },
      })

      rows.push(await tx.membre.create({
        data: {
          userId: user.id, memberId,
          categorie: item.categorie, groupe: item.groupe,
          statut: item.statut, profilFinancier: item.profilFinancier,
          phone: item.phone, email: item.email, profession: item.profession,
          nomConjoint: item.nomConjoint,
        },
        include: { user: { select: { fullName: true, email: true, role: true } } },
      }))
    }
    return rows
  })

  res.status(201).json({ success: true, data: created, meta: { imported: created.length } })
})

export { router as membresRouter }
