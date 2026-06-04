import { Router } from 'express'
import { z } from 'zod'
import { Prisma, PrismaClient } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'

const router = Router()
const prisma = new PrismaClient()

const broadcastSchema = z.object({
  title: z.string().min(3).max(120),
  body: z.string().min(3).max(600),
  type: z.string().min(2).max(40).default('INFO'),
  userIds: z.array(z.string()).optional(),
  role: z.enum(['ADMIN', 'TRESORIER', 'RESPONSABLE', 'ADJOINT_RESPONSABLE', 'COLLECTEUR', 'MEMBRE']).optional(),
  data: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
})

router.get('/', authenticate, async (req, res) => {
  const unreadOnly = req.query.unreadOnly === 'true'
  const notifications = await prisma.notification.findMany({
    where: {
      userId: req.user!.userId,
      ...(unreadOnly ? { isRead: false } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  res.json({ success: true, data: notifications })
})

router.patch('/read-all', authenticate, async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { userId: req.user!.userId, isRead: false },
    data: { isRead: true },
  })

  res.json({ success: true, data: { updated: result.count } })
})

router.patch('/:id/read', authenticate, async (req, res) => {
  const id = String(req.params.id)
  const notification = await prisma.notification.findFirst({
    where: { id, userId: req.user!.userId },
  })

  if (!notification) throw new AppError('NOT_FOUND', 'Notification introuvable', 404)

  const updated = await prisma.notification.update({
    where: { id },
    data: { isRead: true },
  })

  res.json({ success: true, data: updated })
})

router.post('/broadcast', authenticate, requireLevel(3), async (req, res) => {
  const data = broadcastSchema.parse(req.body)

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      ...(data.userIds?.length ? { id: { in: data.userIds } } : {}),
      ...(data.role ? { role: data.role } : {}),
    },
    select: { id: true },
  })

  if (users.length === 0) throw new AppError('NOT_FOUND', 'Aucun destinataire trouve', 404)

  const result = await prisma.notification.createMany({
    data: users.map(user => ({
      userId: user.id,
      title: data.title,
      body: data.body,
      type: data.type,
      data: data.data as Prisma.InputJsonObject | undefined,
      statut: 'SENT',
      sentAt: new Date(),
    })),
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'CREATE',
      entityType: 'Notification',
      entityId: 'broadcast',
      details: { count: result.count, role: data.role, targetedUsers: data.userIds?.length ?? 0 },
    },
  })

  res.status(201).json({ success: true, data: { created: result.count } })
})

export { router as notificationsRouter }
