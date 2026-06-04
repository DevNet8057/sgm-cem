import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'

const router = Router()
const prisma = new PrismaClient()

router.get('/', authenticate, requireLevel(2), async (_req, res) => {
  const prestations = await prisma.prestation.findMany({
    orderBy: { createdAt: 'desc' }
  })
  res.json({ success: true, data: prestations })
})

router.get('/:id', authenticate, requireLevel(2), async (req, res) => {
  const prestation = await prisma.prestation.findUnique({
    where: { id: String(req.params.id) },
    include: { cours: true, entrees: true }
  })
  if (!prestation) res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Prestation introuvable' } })
  else res.json({ success: true, data: prestation })
})

export { router as prestationsRouter }
