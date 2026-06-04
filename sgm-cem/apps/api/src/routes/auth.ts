import { Router } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import rateLimit from 'express-rate-limit'
import { AppError } from '../middleware/errorHandler'
import { authenticate } from '../middleware/auth'
import { getJwtSecret, getRefreshTokenSecret } from '../lib/security'

const router = Router()
const prisma = new PrismaClient()

const authLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 })

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body)

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !user.isActive) throw new AppError('ACCESS_DENIED', 'Identifiants incorrects', 401)

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) throw new AppError('ACCESS_DENIED', 'Identifiants incorrects', 401)

  const payload = { userId: user.id, role: user.role, email: user.email }
  const accessToken = jwt.sign(payload, getJwtSecret(), { expiresIn: '15m' })
  const refreshToken = jwt.sign(payload, getRefreshTokenSecret(), { expiresIn: '7d' })

  await prisma.userSession.create({
    data: {
      userId: user.id,
      refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }
  })

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

  res.json({
    success: true,
    data: {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      }
    }
  })
})

router.post('/refresh', async (req, res) => {
  const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body)

  const session = await prisma.userSession.findUnique({ where: { refreshToken }, include: { user: true } })
  if (!session || session.expiresAt < new Date()) {
    await prisma.userSession.deleteMany({ where: { refreshToken } })
    throw new AppError('ACCESS_DENIED', 'Session expirée', 401)
  }

  try {
    jwt.verify(refreshToken, getRefreshTokenSecret())
  } catch {
    throw new AppError('ACCESS_DENIED', 'Token invalide', 401)
  }

  const { user } = session
  const payload = { userId: user.id, role: user.role, email: user.email }
  const accessToken = jwt.sign(payload, getJwtSecret(), { expiresIn: '15m' })

  res.json({ success: true, data: { accessToken } })
})

router.post('/logout', authenticate, async (req, res) => {
  const { refreshToken } = z.object({ refreshToken: z.string().optional() }).parse(req.body)
  if (refreshToken) {
    await prisma.userSession.deleteMany({ where: { refreshToken } })
  }
  res.json({ success: true })
})

router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, firstName: true, lastName: true, fullName: true, email: true, role: true, lastLoginAt: true }
  })
  if (!user) throw new AppError('NOT_FOUND', 'Utilisateur introuvable', 404)
  res.json({ success: true, data: user })
})

export { router as authRouter }
