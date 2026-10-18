import { Router } from 'express'
import { z } from 'zod'
import multer from 'multer'
import { authenticate } from '../middleware/auth'
import { phoneVariants } from '../lib/otp'
import { AppError } from '../middleware/errorHandler'
import { storeFile, deleteStoredFile, getManagedStorageKey } from '../services/storage'
import { getPrisma } from '../lib/prisma'
import { normalizeInputPhone } from '../lib/phone'
import { audit } from '../services/audit.service'

const router = Router()
const prisma = getPrisma()

// Memory storage: we upload to S3/local via the storage service after receiving
// Extension dérivée du type MIME accepté, jamais du nom fourni par le client
// (un « photo.html » servi depuis /uploads serait exécuté par le navigateur).
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
}
function imageExtension(mimetype: string): string {
  return IMAGE_EXTENSIONS[mimetype] ?? '.jpg'
}

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
  data.phone = normalizeInputPhone(data.phone)
  data.whatsappPhone = normalizeInputPhone(data.whatsappPhone)

  if (data.email) {
    const existing = await prisma.user.findFirst({
      where: { email: data.email, NOT: { id: req.user!.userId } },
    })
    if (existing) throw new AppError('DUPLICATE', 'Cette adresse email est déjà utilisée par un autre compte', 409)
  }

  // Le numéro WhatsApp sert à la connexion par code : il doit désigner un seul compte
  if (data.whatsappPhone) {
    const { all } = phoneVariants(data.whatsappPhone)
    const taken = await prisma.user.findFirst({
      where: { whatsappPhone: { in: all }, NOT: { id: req.user!.userId } },
      select: { id: true },
    })
    if (taken) throw new AppError('DUPLICATE', 'Ce numéro WhatsApp est déjà utilisé par un autre compte', 409)
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

  const ext = imageExtension(req.file.mimetype)
  const key = `avatars/${req.user!.userId}-${Date.now()}${ext}`

  const result = await storeFile(key, req.file.buffer, req.file.mimetype)

  // Supprimer l'ancienne photo si elle est gérée par notre stockage.
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { photoUrl: true } })
  if (user?.photoUrl) {
    const oldKey = getManagedStorageKey(user.photoUrl)
    if (oldKey) await deleteStoredFile(oldKey).catch(() => {})
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
    const key = getManagedStorageKey(user.photoUrl)
    if (key) await deleteStoredFile(key).catch(() => {})
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

  const ext = imageExtension(req.file.mimetype)
  const key = `avatars/${userId}-${Date.now()}${ext}`
  const result = await storeFile(key, req.file.buffer, req.file.mimetype)

  if (target.photoUrl) {
    const oldKey = getManagedStorageKey(target.photoUrl)
    if (oldKey) await deleteStoredFile(oldKey).catch(() => {})
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { photoUrl: result.url },
    select: { id: true, photoUrl: true, fullName: true },
  })

  await audit({ req, userId: req.user!.userId, userName: req.user!.email, action: 'UPDATE', entityType: 'User', entityId: userId, details: { action: 'photo-par-administrateur' } })
  res.json({ success: true, data: updated, storageMode: result.mode })
})

export { router as profileRouter }
