// Santé du système (accueil administrateur, EF-M10-01) et incidents techniques (point 17)
import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { getPrisma } from '../lib/prisma'
import { audit } from '../services/audit.service'
import { getSystemHealth } from '../services/sante.service'

const router = Router()
const prisma = getPrisma()

// GET /api/sante — base, Redis, tâches planifiées, envois, paiements bloqués, incidents ouverts
router.get('/', authenticate, requireRole('ADMIN', 'DEVELOPER'), async (_req, res) => {
  res.json({ success: true, data: await getSystemHealth() })
})

// POST /api/sante/incidents/:id/resoudre — incident traité (journalisé)
router.post('/incidents/:id/resoudre', authenticate, requireRole('ADMIN', 'DEVELOPER'), async (req, res) => {
  const id = String(req.params.id)
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { fullName: true } })
  const result = await prisma.incident.updateMany({ where: { id, resoluLe: null }, data: { resoluLe: new Date(), resoluPar: user?.fullName ?? req.user!.email } })
  if (result.count !== 1) throw new AppError('NOT_FOUND', 'Incident introuvable ou déjà résolu', 404)
  await audit({ req, userId: req.user!.userId, userName: req.user!.email, action: 'UPDATE', entityType: 'Incident', entityId: id, details: { resolu: true } })
  res.json({ success: true, data: { id } })
})

export { router as santeRouter }
