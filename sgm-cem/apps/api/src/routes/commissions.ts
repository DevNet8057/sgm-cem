import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'

const router = Router()
const prisma = new PrismaClient()

router.get('/', authenticate, requireLevel(1), async (_req, res) => {
  const commissions = await prisma.commission.findMany({
    where: { isActive: true },
    include: { _count: { select: { documents: true } } },
    orderBy: { nom: 'asc' }
  })
  res.json({ success: true, data: commissions })
})

router.get('/:id/documents', authenticate, requireLevel(1), async (req, res) => {
  const documents = await prisma.document.findMany({
    where: { commissionId: String(req.params.id) },
    include: { typeDocument: true, uploadedBy: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' }
  })
  res.json({ success: true, data: documents })
})

export { router as commissionsRouter }
