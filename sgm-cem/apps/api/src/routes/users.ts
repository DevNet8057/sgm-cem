import { Router } from 'express'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel, requireRole } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'

const router = Router()
const prisma = new PrismaClient()

const DEFAULT_PASSWORD = 'CEM@2026!'

// Hiérarchie DEVELOPER (niveau 6) > ADMIN (niveau 5) : un ADMIN ne peut pas
// modifier/désactiver/réinitialiser un compte DEVELOPER — sinon il pourrait
// contourner la restriction du panneau développeur.
function assertCanManageTarget(requesterRole: string, targetRole: string) {
  if (targetRole === 'DEVELOPER' && requesterRole !== 'DEVELOPER') {
    throw new AppError('INSUFFICIENT_PERMISSIONS', 'Seul un DEVELOPER peut gérer un compte DEVELOPER', 403)
  }
}

// ── List all users (ADMIN only) ───────────────────────────────────────
router.get('/', authenticate, requireRole('ADMIN', 'DEVELOPER'), async (req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true, memberId: true, firstName: true, lastName: true,
      fullName: true, email: true, phone: true, role: true,
      isActive: true, mustChangePassword: true, lastLoginAt: true,
      createdAt: true,
    },
    orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
  })
  res.json({ success: true, data: users })
})

// ── Create user (ADMIN only) ──────────────────────────────────────────
router.post('/', authenticate, requireRole('ADMIN', 'DEVELOPER'), async (req, res) => {
  const schema = z.object({
    firstName: z.string().min(1),
    lastName:  z.string().min(1),
    email:     z.string().email(),
    phone:     z.string().optional(),
    role:      z.enum(['ADMIN', 'TRESORIER', 'RESPONSABLE', 'ADJOINT_RESPONSABLE', 'COLLECTEUR', 'MEMBRE']),
    password:  z.string().min(8).optional(),
  })
  const data = schema.parse(req.body)
  const fullName = `${data.firstName} ${data.lastName}`

  const existing = await prisma.user.findUnique({ where: { email: data.email } })
  if (existing) throw new AppError('DUPLICATE', 'Un compte avec cet email existe déjà', 409)

  const rawPassword = data.password ?? DEFAULT_PASSWORD
  const passwordHash = await bcrypt.hash(rawPassword, 12)

  const count = await prisma.user.count()
  const memberId = `CEM-${new Date().getFullYear()}-${String(count + 1).padStart(6, '0')}`

  const user = await prisma.user.create({
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      fullName,
      email: data.email,
      phone: data.phone ?? null,
      passwordHash,
      role: data.role,
      memberId,
      isActive: true,
      mustChangePassword: true,
    },
    select: {
      id: true, memberId: true, firstName: true, lastName: true,
      fullName: true, email: true, role: true, isActive: true,
      mustChangePassword: true, createdAt: true,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'CREATE',
      entityType: 'User',
      entityId: user.id,
      details: { role: data.role, email: data.email },
    },
  })

  res.status(201).json({
    success: true,
    data: { ...user, temporaryPassword: rawPassword },
    message: `Compte créé. Mot de passe temporaire : ${rawPassword}`,
  })
})

// ── Update user (ADMIN only) ──────────────────────────────────────────
router.patch('/:id', authenticate, requireRole('ADMIN', 'DEVELOPER'), async (req, res) => {
  const id = String(req.params.id)
  const schema = z.object({
    firstName: z.string().min(1).optional(),
    lastName:  z.string().min(1).optional(),
    email:     z.string().email().optional(),
    phone:     z.string().optional().nullable(),
    role:      z.enum(['ADMIN', 'TRESORIER', 'RESPONSABLE', 'ADJOINT_RESPONSABLE', 'COLLECTEUR', 'MEMBRE']).optional(),
  })
  const data = schema.parse(req.body)

  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) throw new AppError('NOT_FOUND', 'Utilisateur introuvable', 404)
  assertCanManageTarget(req.user!.role, user.role)

  const update: Record<string, unknown> = { ...data }
  if (data.firstName || data.lastName) {
    const first = data.firstName ?? user.firstName
    const last  = data.lastName  ?? user.lastName
    update.fullName = `${first} ${last}`
  }

  const updated = await prisma.user.update({
    where: { id },
    data: update,
    select: {
      id: true, memberId: true, firstName: true, lastName: true,
      fullName: true, email: true, role: true, isActive: true,
      mustChangePassword: true,
    },
  })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'UPDATE',
      entityType: 'User',
      entityId: id,
      details: data,
    },
  })

  res.json({ success: true, data: updated })
})

// ── Toggle active (ADMIN only) ────────────────────────────────────────
router.patch('/:id/toggle-active', authenticate, requireRole('ADMIN', 'DEVELOPER'), async (req, res) => {
  const id = String(req.params.id)
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) throw new AppError('NOT_FOUND', 'Utilisateur introuvable', 404)
  assertCanManageTarget(req.user!.role, user.role)
  if (user.id === req.user!.userId) {
    throw new AppError('BUSINESS_RULE', 'Vous ne pouvez pas désactiver votre propre compte', 400)
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { isActive: !user.isActive },
    select: { id: true, isActive: true, fullName: true },
  })

  res.json({ success: true, data: updated })
})

// ── Reset password (ADMIN only) ───────────────────────────────────────
router.post('/:id/reset-password', authenticate, requireRole('ADMIN', 'DEVELOPER'), async (req, res) => {
  const id = String(req.params.id)
  const { password } = z.object({ password: z.string().min(8).optional() }).parse(req.body)

  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) throw new AppError('NOT_FOUND', 'Utilisateur introuvable', 404)
  assertCanManageTarget(req.user!.role, user.role)

  const rawPassword = password ?? DEFAULT_PASSWORD
  const passwordHash = await bcrypt.hash(rawPassword, 12)

  await prisma.user.update({
    where: { id },
    data: { passwordHash, mustChangePassword: true },
  })

  // Invalider toutes les sessions existantes
  await prisma.userSession.deleteMany({ where: { userId: id } })

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      userName: req.user!.email,
      action: 'UPDATE',
      entityType: 'User',
      entityId: id,
      details: { action: 'password_reset' },
    },
  })

  res.json({
    success: true,
    data: { temporaryPassword: rawPassword },
    message: `Mot de passe réinitialisé. Nouveau mot de passe temporaire : ${rawPassword}`,
  })
})

export { router as usersRouter }
