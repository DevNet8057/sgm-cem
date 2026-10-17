import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { getPrisma } from '../lib/prisma'

const router = Router()
const prisma = getPrisma()

const settingsSchema = z.object({
  defaultIncreaseRate: z.number().min(0).max(100).optional(),
  etudiantRatio: z.number().min(0).max(5).optional(),
  coupleRatio: z.number().min(0).max(5).optional(),
  inactivityMonthsThreshold: z.number().int().min(1).max(60).optional(),
  reminderDelayDays: z.number().int().min(0).max(365).optional(),
  maxFundsRetentionDays: z.number().int().min(1).max(90).optional(),
  // Relances des transferts en attente (0 : désactivé)
  transferPendingReminderHours: z.number().int().min(0).max(720).optional(),
  transferAlertTresorierHours: z.number().int().min(0).max(720).optional(),
  communityName: z.string().min(3).max(120).optional(),
  communityVerse: z.string().min(3).max(600).optional(),
})

router.get('/', authenticate, requireLevel(4), async (_req, res) => {
  const settings = await prisma.systemSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  })
  res.json({ success: true, data: settings })
})

// Ratios et revalorisation : nécessaires à qui crée ou reconduit une rubrique
// (responsables, niveau 3), sans exposer le reste des paramètres
router.get('/ratios', authenticate, requireLevel(3), async (_req, res) => {
  const s = await prisma.systemSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } })
  res.json({ success: true, data: { etudiantRatio: s.etudiantRatio, coupleRatio: s.coupleRatio, defaultIncreaseRate: s.defaultIncreaseRate } })
})

router.patch('/', authenticate, requireLevel(4), async (req, res) => {
  const data = settingsSchema.parse(req.body)

  const settings = await prisma.systemSettings.upsert({
    where: { id: 'singleton' },
    update: data,
    create: { id: 'singleton', ...data },
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'UPDATE',
      entityType: 'SystemSettings',
      entityId: 'singleton',
      details: data,
    },
  })

  res.json({ success: true, data: settings })
})

export { router as settingsRouter }
