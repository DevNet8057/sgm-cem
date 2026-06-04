import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'

const router = Router()
const prisma = new PrismaClient()

router.get('/', authenticate, requireLevel(4), async (_req, res) => {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } })
  res.json({ success: true, data: settings })
})

export { router as settingsRouter }
