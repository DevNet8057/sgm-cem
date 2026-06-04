import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'

const router = Router()
const prisma = new PrismaClient()

const createSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  categorie: z.enum(['MCE_EN_SERVICE', 'ENFANTS', 'DIASPORA']),
  groupe: z.enum(['TEMPLE', 'MVOG_BETSI', 'BISCUITERIE', 'OBILI', 'SCIENCES', 'POLYTECHNIQUE']),
  statut: z.enum(['EN_OBSERVATION', 'EN_SUIVI', 'FIN_DE_SUIVI', 'DIASPORA']).default('EN_OBSERVATION'),
  profilFinancier: z.enum(['TRAVAILLEUR', 'ETUDIANT', 'COUPLE']).default('TRAVAILLEUR'),
  profession: z.string().optional(),
  password: z.string().min(6).optional(),
})

const updateSchema = z.object({
  firstName: z.string().min(2).optional(),
  lastName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  phoneWhatsapp: z.string().optional(),
  adresse: z.string().optional(),
  profession: z.string().optional(),
  notes: z.string().optional(),
  dateAdhesion: z.string().datetime().optional(),
  dateNaissance: z.string().datetime().optional(),
  categorie: z.enum(['MCE_EN_SERVICE', 'ENFANTS', 'DIASPORA']).optional(),
  groupe: z.enum(['TEMPLE', 'MVOG_BETSI', 'BISCUITERIE', 'OBILI', 'SCIENCES', 'POLYTECHNIQUE']).optional(),
  statut: z.enum(['EN_OBSERVATION', 'EN_SUIVI', 'FIN_DE_SUIVI', 'DIASPORA']).optional(),
  profilFinancier: z.enum(['TRAVAILLEUR', 'ETUDIANT', 'COUPLE']).optional(),
  isActive: z.boolean().optional(),
})

const importSchema = z.object({
  membres: z.array(createSchema.omit({ password: true })).min(1).max(500),
})

async function nextMemberId(): Promise<string> {
  const count = await prisma.user.count()
  return `CEM-${new Date().getFullYear()}-${String(count + 1).padStart(6, '0')}`
}

async function nextMemberIds(count: number): Promise<string[]> {
  const start = await prisma.user.count()
  const year = new Date().getFullYear()
  return Array.from({ length: count }, (_, index) =>
    `CEM-${year}-${String(start + index + 1).padStart(6, '0')}`
  )
}

router.get('/', authenticate, requireLevel(2), async (req, res) => {
  const { page = '1', limit = '20', search, groupe, statut } = req.query as Record<string, string>
  const skip = (parseInt(page) - 1) * parseInt(limit)

  const where = {
    isActive: true,
    ...(search && {
      user: { fullName: { contains: search, mode: 'insensitive' as const } }
    }),
    ...(groupe && { groupe: groupe as never }),
    ...(statut && { statut: statut as never }),
  }

  const [membres, total] = await Promise.all([
    prisma.membre.findMany({
      where, skip, take: parseInt(limit),
      include: { user: { select: { fullName: true, email: true, role: true } } },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.membre.count({ where })
  ])

  res.json({
    success: true,
    data: membres,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) }
  })
})

router.get('/:id', authenticate, requireLevel(2), async (req, res) => {
  const membre = await prisma.membre.findUnique({
    where: { id: String(req.params.id) },
    include: {
      user: { select: { fullName: true, email: true, role: true } },
      contributions: { include: { rubrique: true }, orderBy: { createdAt: 'desc' }, take: 10 }
    }
  })
  if (!membre) res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Membre introuvable' } })
  else res.json({ success: true, data: membre })
})

router.post('/', authenticate, requireLevel(3), async (req, res) => {
  const data = createSchema.parse(req.body)
  const existing = await prisma.user.findUnique({ where: { email: data.email } })
  if (existing) throw new AppError('DUPLICATE', 'Cette adresse email existe déjà')

  const memberId = await nextMemberId()
  const fullName = `${data.firstName} ${data.lastName}`
  const passwordHash = await bcrypt.hash(data.password ?? 'ChristEst!2026', 12)

  const membre = await prisma.$transaction(async tx => {
    const user = await tx.user.create({
      data: {
        memberId,
        firstName: data.firstName,
        lastName: data.lastName,
        fullName,
        email: data.email,
        phone: data.phone,
        passwordHash,
        role: 'MEMBRE',
        isActive: true,
      }
    })

    return tx.membre.create({
      data: {
        userId: user.id,
        memberId,
        categorie: data.categorie,
        groupe: data.groupe,
        statut: data.statut,
        profilFinancier: data.profilFinancier,
        phone: data.phone,
        email: data.email,
        profession: data.profession,
      },
      include: { user: { select: { fullName: true, email: true, role: true } } }
    })
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'CREATE',
      entityType: 'Membre',
      entityId: membre.id,
      details: { memberId: membre.memberId, fullName },
    }
  })

  res.status(201).json({ success: true, data: membre })
})

router.post('/import', authenticate, requireLevel(3), async (req, res) => {
  const { membres } = importSchema.parse(req.body)
  const emails = membres.map(m => m.email)
  const duplicateInput = emails.find((email, index) => emails.indexOf(email) !== index)
  if (duplicateInput) throw new AppError('DUPLICATE', `Email en double dans le fichier: ${duplicateInput}`)

  const existing = await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } })
  if (existing.length) throw new AppError('DUPLICATE', `Email deja existant: ${existing[0].email}`)

  const memberIds = await nextMemberIds(membres.length)
  const passwordHash = await bcrypt.hash('ChristEst!2026', 12)

  const created = await prisma.$transaction(async tx => {
    const rows = []
    for (const [index, item] of membres.entries()) {
      const memberId = memberIds[index]
      const fullName = `${item.firstName} ${item.lastName}`
      const user = await tx.user.create({
        data: {
          memberId,
          firstName: item.firstName,
          lastName: item.lastName,
          fullName,
          email: item.email,
          phone: item.phone,
          passwordHash,
          role: 'MEMBRE',
          isActive: true,
        }
      })

      rows.push(await tx.membre.create({
        data: {
          userId: user.id,
          memberId,
          categorie: item.categorie,
          groupe: item.groupe,
          statut: item.statut,
          profilFinancier: item.profilFinancier,
          phone: item.phone,
          email: item.email,
          profession: item.profession,
        },
        include: { user: { select: { fullName: true, email: true, role: true } } }
      }))
    }
    return rows
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'CREATE',
      entityType: 'MembreImport',
      details: { count: created.length },
    }
  })

  res.status(201).json({ success: true, data: created, meta: { imported: created.length } })
})

router.patch('/:id', authenticate, requireLevel(3), async (req, res) => {
  const id = String(req.params.id)
  const data = updateSchema.parse(req.body)
  const current = await prisma.membre.findUnique({ where: { id }, include: { user: true } })
  if (!current) throw new AppError('NOT_FOUND', 'Membre introuvable', 404)

  if (data.email && data.email !== current.user.email) {
    const existing = await prisma.user.findUnique({ where: { email: data.email } })
    if (existing) throw new AppError('DUPLICATE', 'Cette adresse email existe deja')
  }

  const firstName = data.firstName ?? current.user.firstName
  const lastName = data.lastName ?? current.user.lastName
  const fullName = `${firstName} ${lastName}`

  const membre = await prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id: current.userId },
      data: {
        firstName,
        lastName,
        fullName,
        email: data.email,
        phone: data.phone,
        isActive: data.isActive,
      }
    })

    return tx.membre.update({
      where: { id },
      data: {
        categorie: data.categorie,
        groupe: data.groupe,
        statut: data.statut,
        profilFinancier: data.profilFinancier,
        phone: data.phone,
        phoneWhatsapp: data.phoneWhatsapp,
        email: data.email,
        adresse: data.adresse,
        profession: data.profession,
        notes: data.notes,
        dateAdhesion: data.dateAdhesion ? new Date(data.dateAdhesion) : undefined,
        dateNaissance: data.dateNaissance ? new Date(data.dateNaissance) : undefined,
        isActive: data.isActive,
      },
      include: { user: { select: { fullName: true, email: true, role: true } } }
    })
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'UPDATE',
      entityType: 'Membre',
      entityId: membre.id,
      details: data,
    }
  })

  res.json({ success: true, data: membre })
})

router.patch('/:id/status', authenticate, requireLevel(3), async (req, res) => {
  const { statut } = z.object({
    statut: z.enum(['EN_OBSERVATION', 'EN_SUIVI', 'FIN_DE_SUIVI', 'DIASPORA'])
  }).parse(req.body)

  const membre = await prisma.membre.update({
    where: { id: String(req.params.id) },
    data: { statut },
    include: { user: { select: { fullName: true, email: true, role: true } } }
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'UPDATE',
      entityType: 'Membre',
      entityId: membre.id,
      details: { statut },
    }
  })

  res.json({ success: true, data: membre })
})

export { router as membresRouter }
