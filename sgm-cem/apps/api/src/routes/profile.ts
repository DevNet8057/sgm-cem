import { getConfig } from '../services/config.service'
import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import multer from 'multer'
import path from 'path'
import { authenticate } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { storeFile, deleteStoredFile } from '../services/storage'

const router = Router()
const prisma = new PrismaClient()

// Memory storage: we upload to S3/local via the storage service after receiving
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Mo
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true)
    else cb(new Error('Format non supporté. Utilisez JPEG, PNG ou WebP.'))
  },
})

// ── GET mon profil ────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: {
      id: true, memberId: true, firstName: true, lastName: true, fullName: true,
      email: true, phone: true, whatsappPhone: true, role: true,
      isActive: true, mustChangePassword: true, photoUrl: true,
      lastLoginAt: true, createdAt: true,
    },
  })
  if (!user) throw new AppError('NOT_FOUND', 'Utilisateur introuvable', 404)

  const membre = await prisma.membre.findFirst({
    where: { userId: req.user!.userId },
    select: { id: true, memberId: true, categorie: true, groupe: true, statut: true, profilFinancier: true, profession: true, dateAdhesion: true },
  })

  res.json({ success: true, data: { ...user, membre } })
})

// ── PATCH mes informations ────────────────────────────────────────────
router.patch('/', authenticate, async (req, res) => {
  const schema = z.object({
    firstName:     z.string().min(1).optional(),
    lastName:      z.string().min(1).optional(),
    email:         z.string().email().optional(),
    phone:         z.string().optional().nullable(),
    whatsappPhone: z.string().optional().nullable(),
  })
  const data = schema.parse(req.body)

  if (data.email) {
    const existing = await prisma.user.findFirst({
      where: { email: data.email, NOT: { id: req.user!.userId } },
    })
    if (existing) throw new AppError('DUPLICATE', 'Cette adresse email est déjà utilisée par un autre compte', 409)
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })
  if (!user) throw new AppError('NOT_FOUND', 'Utilisateur introuvable', 404)

  const update: Record<string, unknown> = { ...data }
  if (data.firstName || data.lastName) {
    update.fullName = `${data.firstName ?? user.firstName} ${data.lastName ?? user.lastName}`
  }

  const updated = await prisma.user.update({
    where: { id: req.user!.userId },
    data: update,
    select: {
      id: true, firstName: true, lastName: true, fullName: true,
      email: true, phone: true, whatsappPhone: true, photoUrl: true,
    },
  })

  const membre = await prisma.membre.findFirst({ where: { userId: req.user!.userId } })
  if (membre) {
    await prisma.membre.update({
      where: { id: membre.id },
      data: { phone: data.phone !== undefined ? (data.phone ?? undefined) : undefined },
    })
  }

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId, userName: req.user!.email,
      action: 'UPDATE', entityType: 'User', entityId: req.user!.userId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      details: { action: 'profile_update', fields: Object.keys(data) } as any,
    },
  })

  res.json({ success: true, data: updated })
})

// ── POST photo de profil ──────────────────────────────────────────────
router.post('/photo', authenticate, upload.single('photo'), async (req, res) => {
  if (!req.file) throw new AppError('VALIDATION_ERROR', 'Aucun fichier fourni', 400)

  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg'
  const key = `avatars/${req.user!.userId}-${Date.now()}${ext}`

  const result = await storeFile(key, req.file.buffer, req.file.mimetype)

  // Supprimer l'ancienne photo si c'est un fichier local géré par nous
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { photoUrl: true } })
  if (user?.photoUrl) {
    // Extract key from old URL if it contains our API URL pattern
    const apiUrl = getConfig('API_URL') ?? 'http://localhost:3001'
    if (user.photoUrl.startsWith(`${apiUrl}/uploads/`)) {
      const oldKey = user.photoUrl.replace(`${apiUrl}/uploads/`, '')
      await deleteStoredFile(oldKey).catch(() => {})
    }
  }

  const updated = await prisma.user.update({
    where: { id: req.user!.userId },
    data: { photoUrl: result.url },
    select: { id: true, photoUrl: true },
  })

  res.json({ success: true, data: updated, storageMode: result.mode })
})

// ── DELETE photo de profil ────────────────────────────────────────────
router.delete('/photo', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { photoUrl: true } })
  if (user?.photoUrl) {
    const apiUrl = getConfig('API_URL') ?? 'http://localhost:3001'
    if (user.photoUrl.startsWith(`${apiUrl}/uploads/`)) {
      const key = user.photoUrl.replace(`${apiUrl}/uploads/`, '')
      await deleteStoredFile(key).catch(() => {})
    }
  }
  await prisma.user.update({ where: { id: req.user!.userId }, data: { photoUrl: null } })
  res.json({ success: true })
})

// ── ADMIN: upload photo pour n'importe quel utilisateur ──────────────
router.post('/:userId/photo', authenticate, upload.single('photo'), async (req, res) => {
  if (!['ADMIN', 'DEVELOPER'].includes(req.user!.role)) throw new AppError('ACCESS_DENIED', 'Réservé aux administrateurs', 403)
  if (!req.file) throw new AppError('VALIDATION_ERROR', 'Aucun fichier fourni', 400)

  const userId = String(req.params.userId)
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { photoUrl: true } })
  if (!target) throw new AppError('NOT_FOUND', 'Utilisateur introuvable', 404)

  const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg'
  const key = `avatars/${userId}-${Date.now()}${ext}`
  const result = await storeFile(key, req.file.buffer, req.file.mimetype)

  if (target.photoUrl) {
    const apiUrl = getConfig('API_URL') ?? 'http://localhost:3001'
    if (target.photoUrl.startsWith(`${apiUrl}/uploads/`)) {
      const oldKey = target.photoUrl.replace(`${apiUrl}/uploads/`, '')
      await deleteStoredFile(oldKey).catch(() => {})
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { photoUrl: result.url },
    select: { id: true, photoUrl: true, fullName: true },
  })

  res.json({ success: true, data: updated, storageMode: result.mode })
})

export { router as profileRouter }
