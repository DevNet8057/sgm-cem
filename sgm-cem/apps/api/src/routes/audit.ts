import { Router } from 'express'
import { PrismaClient, type Prisma, AuditAction } from '@prisma/client'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { ROLE_LEVELS } from '../middleware/rbac'

const router = Router()
const prisma = new PrismaClient()

// Entités « financières » visibles par la chaîne de supervision
// (TRESORIER, RESPONSABLE, ADJOINT_RESPONSABLE) en plus de leur propre activité.
const FINANCIAL_ENTITIES = ['Contribution', 'FundsTransfer', 'BankDeposit', 'Rubrique', 'Prestation']

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  action: z.nativeEnum(AuditAction).optional(),
  entityType: z.string().max(50).optional(),
  userId: z.string().max(50).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().max(100).optional(),
})

// ── GET /api/audit — journal « qui a fait quoi », filtré selon le rôle ──
// DEVELOPER : tout. ADMIN : tout sauf les changements de config du panneau
// développeur. Niveau 3-4 (TRESORIER, RESPONSABLE…) : opérations financières
// + sa propre activité. Niveau 1-2 (COLLECTEUR, MEMBRE) : sa propre activité.
router.get('/', authenticate, async (req, res) => {
  const { page, limit, action, entityType, userId, from, to, q } = querySchema.parse(req.query)

  const role = req.user!.role
  const level = ROLE_LEVELS[role] ?? 0
  const me = req.user!.userId

  const conditions: Prisma.AuditLogWhereInput[] = []

  // Périmètre de visibilité (non contournable par les filtres, combiné en AND)
  if (role === 'ADMIN') {
    conditions.push({ action: { not: 'DEVELOPER_PANEL_CONFIG_CHANGED' } })
  } else if (role !== 'DEVELOPER') {
    if (level >= 3) {
      conditions.push({ OR: [{ entityType: { in: FINANCIAL_ENTITIES } }, { userId: me }] })
    } else {
      conditions.push({ userId: me })
    }
  }

  // Filtres utilisateur
  if (action) conditions.push({ action })
  if (entityType) conditions.push({ entityType })
  if (userId) conditions.push({ userId })
  if (from) conditions.push({ createdAt: { gte: from } })
  if (to) {
    // borne « to » inclusive : fin de journée
    const end = new Date(to)
    end.setHours(23, 59, 59, 999)
    conditions.push({ createdAt: { lte: end } })
  }
  if (q) conditions.push({ userName: { contains: q, mode: 'insensitive' } })

  const where: Prisma.AuditLogWhereInput = { AND: conditions }

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { user: { select: { role: true } } },
    }),
  ])

  res.json({
    success: true,
    data: {
      logs,
      total,
      page,
      pageSize: limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  })
})

// ── GET /api/audit/users — liste des acteurs pour le filtre (niveau 3+) ──
router.get('/users', authenticate, async (req, res) => {
  const level = ROLE_LEVELS[req.user!.role] ?? 0
  if (level < 3) {
    res.json({ success: true, data: [] })
    return
  }
  const users = await prisma.user.findMany({
    where: { auditLogs: { some: {} } },
    select: { id: true, fullName: true, role: true },
    orderBy: { fullName: 'asc' },
  })
  res.json({ success: true, data: users })
})

export { router as auditRouter }
