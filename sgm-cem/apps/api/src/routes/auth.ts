import { Router, type Response } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import rateLimit from 'express-rate-limit'
import { OAuth2Client } from 'google-auth-library'
import { AppError } from '../middleware/errorHandler'
import { authenticate } from '../middleware/auth'
import { getJwtSecret, getRefreshTokenSecret } from '../lib/security'
import { sendSMS, sendWhatsApp } from '../services/notification'

const router = Router()
const prisma = new PrismaClient()
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

const authLimiter  = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 })
const otpLimiter   = rateLimit({ windowMs: 10 * 60 * 1000, max: 5, message: { success: false, error: { code: 'RATE_LIMITED', message: 'Trop de tentatives. Attendez 10 minutes.' } } })

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

// ── Cookie helpers ────────────────────────────────────────────────────
const IS_PROD = process.env.NODE_ENV === 'production'

function setAuthCookies(res: Response, accessToken: string, refreshToken?: string): void {
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000,
    path: '/',
  })
  if (refreshToken) {
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    })
  }
}

function clearAuthCookies(res: Response): void {
  res.clearCookie('access_token', { path: '/' })
  res.clearCookie('refresh_token', { path: '/' })
}

// ── Helper : build token payload ──────────────────────────────────────
function buildUser(user: {
  id: string; firstName: string; lastName: string; fullName: string
  email: string; role: string; mustChangePassword: boolean
}) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  }
}

async function createSessionTokens(user: { id: string; role: string; email: string }, prismaClient: PrismaClient) {
  const payload = { userId: user.id, role: user.role, email: user.email }
  const accessToken = jwt.sign(payload, getJwtSecret(), { expiresIn: '15m' })
  const refreshToken = jwt.sign(payload, getRefreshTokenSecret(), { expiresIn: '7d' })

  await prismaClient.userSession.create({
    data: {
      userId: user.id,
      refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })
  await prismaClient.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  return { accessToken, refreshToken }
}

// ── Email / password login ────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body)

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !user.isActive) throw new AppError('ACCESS_DENIED', 'Identifiants incorrects', 401)

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) throw new AppError('ACCESS_DENIED', 'Identifiants incorrects', 401)

  const { accessToken, refreshToken } = await createSessionTokens(user, prisma)

  setAuthCookies(res, accessToken, refreshToken)
  res.json({ success: true, data: { user: buildUser(user) } })
})

// ── Mot de passe oublié ────────────────────────────────────────────────
// Renvoie la marche à suivre selon le type de compte (anti-énumération :
// même structure de réponse que le compte existe ou non).
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body)

  const user = await prisma.user.findUnique({ where: { email } })

  // Compte ADMIN actif → récupération via connexion Google (pas de mot de passe à réinitialiser)
  if (user?.role === 'ADMIN' && user.isActive) {
    res.json({
      success: true,
      data: {
        method: 'google',
        message: `Cliquez sur "Continuer avec Google" et connectez-vous avec le compte Google associé à ${email}.`,
      },
    })
    return
  }

  // Membre (ou compte introuvable/inactif) → contacter l'administrateur
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
    select: { fullName: true, email: true, phone: true, whatsappPhone: true },
    orderBy: { createdAt: 'asc' },
  })

  res.json({
    success: true,
    data: {
      method: 'admin_contact',
      message: "Pour réinitialiser votre mot de passe, contactez l'administrateur du système qui pourra le réinitialiser depuis son espace.",
      admin: admin ? {
        fullName: admin.fullName,
        email: admin.email,
        phone: admin.whatsappPhone ?? admin.phone ?? null,
      } : null,
    },
  })
})

// ── OTP : demande de code (téléphone doit être en BD) ────────────────
router.post('/otp/request', otpLimiter, async (req, res) => {
  const { phone } = z.object({ phone: z.string().min(8) }).parse(req.body)
  const normalized = phone.replace(/\D/g, '')
  const full = normalized.startsWith('237') ? `+${normalized}` : `+237${normalized}`

  // Chercher l'utilisateur par phone OU whatsappPhone
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { phone: { in: [normalized, full, phone] } },
        { whatsappPhone: { in: [normalized, full, phone] } },
      ]
    },
    select: { id: true, isActive: true, phone: true, whatsappPhone: true },
  })

  // Réponse identique que trouvé ou non (anti-énumération)
  if (!user || !user.isActive) {
    res.json({ success: true, message: 'Si ce numéro est enregistré, vous recevrez un code WhatsApp.' })
    return
  }

  // Invalider les anciens codes non expirés
  await prisma.otpCode.updateMany({
    where: { phone: full, used: false, expiresAt: { gt: new Date() } },
    data: { used: true },
  })

  const code = String(Math.floor(100000 + Math.random() * 900000))
  await prisma.otpCode.create({
    data: { phone: full, code, expiresAt: new Date(Date.now() + 5 * 60 * 1000) },
  })

  const msg = `*SGM-CEM* — Code de connexion : *${code}*\n⏱ Valable 5 minutes.\n🔒 Ne le partagez pas.`

  // Envoyer en priorité sur le numéro WhatsApp enregistré, fallback SMS
  const waTarget = user.whatsappPhone ?? user.phone ?? full
  const waOk = await sendWhatsApp(waTarget, msg)
  if (!waOk && user.phone) await sendSMS(user.phone, `SGM-CEM - Code: ${code} - Valable 5 min`)

  // En développement, afficher le code dans les logs serveur si les services ne sont pas configurés
  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n📱 [DEV OTP] ${full}  →  Code : ${code}\n`)
  }

  res.json({ success: true, message: 'Code envoyé sur WhatsApp. Vérifiez vos messages.' })
})

// ── OTP : vérification du code ────────────────────────────────────────
router.post('/otp/verify', otpLimiter, async (req, res) => {
  const { phone, code } = z.object({ phone: z.string(), code: z.string().length(6) }).parse(req.body)
  const normalized = phone.replace(/\D/g, '')
  const full = normalized.startsWith('237') ? `+${normalized}` : `+237${normalized}`

  const otpRecord = await prisma.otpCode.findFirst({
    where: {
      phone: full,
      used: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!otpRecord) {
    throw new AppError('ACCESS_DENIED', 'Code OTP invalide ou expiré. Demandez un nouveau code.', 401)
  }

  // Incrémenter les tentatives
  await prisma.otpCode.update({ where: { id: otpRecord.id }, data: { attempts: { increment: 1 } } })

  if (otpRecord.attempts >= 3) {
    await prisma.otpCode.update({ where: { id: otpRecord.id }, data: { used: true } })
    throw new AppError('ACCESS_DENIED', 'Trop de tentatives. Demandez un nouveau code.', 401)
  }

  if (otpRecord.code !== code) {
    throw new AppError('ACCESS_DENIED', `Code incorrect. ${2 - otpRecord.attempts} tentative(s) restante(s).`, 401)
  }

  // Marquer le code comme utilisé
  await prisma.otpCode.update({ where: { id: otpRecord.id }, data: { used: true } })

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { phone: { in: [normalized, full, phone] } },
        { whatsappPhone: { in: [normalized, full, phone] } },
      ]
    }
  })
  if (!user || !user.isActive) throw new AppError('ACCESS_DENIED', 'Compte introuvable ou désactivé.', 403)

  const { accessToken, refreshToken } = await createSessionTokens(user, prisma)

  setAuthCookies(res, accessToken, refreshToken)
  res.json({ success: true, data: { user: buildUser(user) } })
})

// ── Google OAuth — email must already exist ───────────────────────────
router.post('/google', authLimiter, async (req, res) => {
  const { idToken } = z.object({ idToken: z.string() }).parse(req.body)

  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new AppError('SERVER_ERROR', 'Connexion Google non configurée', 503)
  }

  let ticket
  try {
    ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    })
  } catch {
    throw new AppError('ACCESS_DENIED', 'Token Google invalide ou expiré', 401)
  }

  const payload = ticket.getPayload()
  if (!payload?.email) throw new AppError('ACCESS_DENIED', "Impossible de récupérer l'email Google", 401)

  // RESTRICTION : l'email doit déjà exister (créé par un admin)
  const user = await prisma.user.findUnique({ where: { email: payload.email } })
  if (!user) {
    throw new AppError(
      'ACCESS_DENIED',
      "Aucun compte associé à cette adresse Google. Contactez l'administrateur pour créer votre compte.",
      403
    )
  }
  if (!user.isActive) {
    throw new AppError('ACCESS_DENIED', 'Compte désactivé. Contactez l\'administrateur.', 403)
  }

  const { accessToken, refreshToken } = await createSessionTokens(user, prisma)

  setAuthCookies(res, accessToken, refreshToken)
  res.json({ success: true, data: { user: buildUser(user) } })
})

// ── Change password (forcé 1ère connexion ou volontaire) ──────────────
router.post('/change-password', authenticate, async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string()
      .min(8, 'Le nouveau mot de passe doit contenir au moins 8 caractères')
      .regex(/[A-Z]/, 'Doit contenir au moins une majuscule')
      .regex(/[0-9]/, 'Doit contenir au moins un chiffre'),
  })
  const { currentPassword, newPassword } = schema.parse(req.body)

  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })
  if (!user) throw new AppError('NOT_FOUND', 'Utilisateur introuvable', 404)

  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) throw new AppError('ACCESS_DENIED', 'Mot de passe actuel incorrect', 401)

  if (currentPassword === newPassword) {
    throw new AppError('VALIDATION_ERROR', 'Le nouveau mot de passe doit être différent de l\'actuel', 400)
  }

  const passwordHash = await bcrypt.hash(newPassword, 12)
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  })

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userName: user.fullName,
      action: 'UPDATE',
      entityType: 'User',
      entityId: user.id,
      details: { action: 'password_changed' },
    },
  })

  res.json({ success: true, message: 'Mot de passe modifié avec succès' })
})

// ── Refresh token ─────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const refreshToken: string | undefined = req.cookies?.refresh_token

  if (!refreshToken) throw new AppError('ACCESS_DENIED', 'Session expirée', 401)

  const session = await prisma.userSession.findUnique({ where: { refreshToken }, include: { user: true } })
  if (!session || session.expiresAt < new Date()) {
    await prisma.userSession.deleteMany({ where: { refreshToken } })
    clearAuthCookies(res)
    throw new AppError('ACCESS_DENIED', 'Session expirée', 401)
  }

  try {
    jwt.verify(refreshToken, getRefreshTokenSecret())
  } catch {
    clearAuthCookies(res)
    throw new AppError('ACCESS_DENIED', 'Token invalide', 401)
  }

  const { user } = session
  const payload = { userId: user.id, role: user.role, email: user.email }
  const accessToken = jwt.sign(payload, getJwtSecret(), { expiresIn: '15m' })

  setAuthCookies(res, accessToken)
  res.json({ success: true })
})

// ── Logout ────────────────────────────────────────────────────────────
router.post('/logout', authenticate, async (req, res) => {
  const refreshToken: string | undefined = req.cookies?.refresh_token
  if (refreshToken) {
    await prisma.userSession.deleteMany({ where: { refreshToken } })
  }
  clearAuthCookies(res)
  res.json({ success: true })
})

// ── Me ────────────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: {
      id: true, firstName: true, lastName: true, fullName: true,
      email: true, role: true, lastLoginAt: true, mustChangePassword: true,
    },
  })
  if (!user) throw new AppError('NOT_FOUND', 'Utilisateur introuvable', 404)
  res.json({ success: true, data: user })
})

export { router as authRouter }
