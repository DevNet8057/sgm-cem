import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { limiter } from '../middleware/rate-limit'
import { OAuth2Client } from 'google-auth-library'
import { AppError } from '../middleware/errorHandler'
import { authenticate } from '../middleware/auth'
import { hashPassword, needsRehash, verifyPassword } from '../lib/password'
import { generateOtpCode, hashOtpCode, OTP_MAX_PER_PHONE_PER_HOUR, OTP_TTL_MS, otpMatches, phoneVariants } from '../lib/otp'
import { forgetUserState, openSession, refreshSession, revokeSessionByRefreshToken, revokeUserSessions, signAccessToken } from '../lib/session'
import { sendSMS, sendWhatsApp } from '../services/notification'
import { getConfig } from '../services/config.service'
import { audit } from '../services/audit.service'
import { closeActivitySessionForLogout } from '../services/activity-write.service'
import { getPrisma } from '../lib/prisma'

const router = Router()
const prisma = getPrisma()

// Client Google reconstruit si le Client ID change depuis le panneau
// développeur (lecture au moment de l'appel, pas au chargement du module).
let googleClient: OAuth2Client | null = null
let googleClientId = ''

function getGoogleClient(): OAuth2Client | null {
  const clientId = getConfig('GOOGLE_CLIENT_ID')
  if (!clientId) return null
  if (googleClient && clientId === googleClientId) return googleClient
  googleClient = new OAuth2Client(clientId)
  googleClientId = clientId
  return googleClient
}

const authLimiter = limiter(60 * 60 * 1000, 15, 'Trop de tentatives. Réessayez dans quelques minutes.')
const otpLimiter  = limiter(10 * 60 * 1000, 5, 'Trop de tentatives. Attendez 10 minutes.')

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

// ── Cookie helpers ────────────────────────────────────────────────────
const IS_PROD = process.env.NODE_ENV === 'production'

// Exporté pour routes/developer.ts (impersonation) — accessMaxAgeMs permet
// une durée de cookie alignée sur le jeton d'impersonation (1 h).
export function setAuthCookies(req: Request, res: Response, accessToken: string, refreshToken?: string, accessMaxAgeMs = 15 * 60 * 1000): void {
  const isSecure = req.secure // fiable grâce à « trust proxy » (index.ts)
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: accessMaxAgeMs,
    path: '/',
  })
  if (refreshToken) {
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
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
  email: string; role: string; mustChangePassword: boolean; photoUrl: string | null
}) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    photoUrl: user.photoUrl,
  }
}

async function createSessionTokens(user: { id: string; role: string; email: string }, prismaClient: PrismaClient) {
  const { accessToken, refreshToken } = await openSession(user, prismaClient)
  await prismaClient.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  return { accessToken, refreshToken }
}

// ── Email / password login ────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body)
  const normalizedEmail = email.toLowerCase().trim()

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })
  if (!user || !user.isActive) {
    await verifyPassword(password, null) // même durée de réponse que pour un compte existant
    throw new AppError('ACCESS_DENIED', 'Identifiants incorrects', 401)
  }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    await audit({
      req, userId: user.id, userName: user.fullName,
      action: 'LOGIN', entityType: 'Session',
      details: { method: 'email', success: false, reason: 'wrong_password' },
    })
    throw new AppError('ACCESS_DENIED', 'Identifiants incorrects', 401)
  }

  // Migration transparente des anciens hachages bcrypt vers Argon2id
  if (needsRehash(user.passwordHash)) {
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } })
  }

  const { accessToken, refreshToken } = await createSessionTokens(user, prisma)

  await audit({
    req, userId: user.id, userName: user.fullName,
    action: 'LOGIN', entityType: 'Session',
    details: { method: 'email', success: true, role: user.role },
  })

  setAuthCookies(req, res, accessToken, refreshToken)
  res.json({ success: true, data: { user: buildUser(user) } })
})

// ── Mot de passe oublié ────────────────────────────────────────────────
// Réponse STRICTEMENT identique quel que soit l'email (existant, inconnu,
// administrateur…) : rien ne permet de deviner quels comptes existent.
router.post('/forgot-password', authLimiter, async (req, res) => {
  z.object({ email: z.string().email() }).parse(req.body)

  const admin = await prisma.user.findFirst({
    where: { role: { in: ['ADMIN', 'DEVELOPER'] }, isActive: true },
    select: { fullName: true, email: true, phone: true, whatsappPhone: true },
    orderBy: { createdAt: 'asc' },
  })

  res.json({
    success: true,
    data: {
      method: 'admin_contact',
      message: "Si un compte correspond à cette adresse, l'administrateur peut réinitialiser son mot de passe depuis son espace. "
        + 'Les comptes associés à Google se connectent avec « Continuer avec Google ». '
        + 'Les membres peuvent aussi se connecter par code reçu sur leur téléphone.',
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
  const { phone } = z.object({ phone: z.string().min(8).max(20) }).parse(req.body)
  const { full, all } = phoneVariants(phone)
  // Réponse identique dans tous les cas (numéro inconnu, partagé, limité…) : anti-énumération
  const genericReply = () => res.json({ success: true, message: 'Si ce numéro est enregistré, vous recevrez un code par WhatsApp ou SMS.' })

  // Un numéro rattaché à plusieurs comptes ne permet pas de savoir qui se connecte : refus
  const users = await prisma.user.findMany({
    where: { isActive: true, OR: [{ phone: { in: all } }, { whatsappPhone: { in: all } }] },
    select: { id: true, phone: true, whatsappPhone: true },
    take: 2,
  })
  if (users.length !== 1) {
    if (users.length > 1) console.warn('[OTP] Numéro partagé par plusieurs comptes actifs — connexion par code refusée')
    genericReply()
    return
  }
  const [user] = users

  // Limite par numéro (en plus de la limite par IP)
  const recent = await prisma.otpCode.count({
    where: { phone: full, purpose: 'LOGIN', createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
  })
  if (recent >= OTP_MAX_PER_PHONE_PER_HOUR) {
    genericReply()
    return
  }

  // Invalider les anciens codes de CONNEXION non expirés (purpose scoping :
  // un code DRAFT_RECOVERY du même numéro n'est pas touché — anti-rejeu inter-flux)
  await prisma.otpCode.updateMany({
    where: { phone: full, used: false, purpose: 'LOGIN', expiresAt: { gt: new Date() } },
    data: { used: true },
  })

  const code = generateOtpCode()
  await prisma.otpCode.create({
    data: { phone: full, code: hashOtpCode(full, 'LOGIN', code), purpose: 'LOGIN', expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  })

  const msg = `*SGM-CEM* — Code de connexion : *${code}*\n⏱ Valable 5 minutes.\n🔒 Ne le partagez pas.`

  // Envoyer en priorité sur le numéro WhatsApp enregistré, fallback SMS
  const waTarget = user.whatsappPhone ?? user.phone ?? full
  const waOk = await sendWhatsApp(waTarget, msg)
  if (!waOk && user.phone) await sendSMS(user.phone, `SGM-CEM - Code: ${code} - Valable 5 min`)

  // En développement, afficher le code dans les logs serveur si les services ne sont pas configurés
  if (process.env.NODE_ENV === 'development') {
    console.log(`\n📱 [DEV OTP] ${full}  →  Code : ${code}\n`)
  }

  genericReply()
})

// ── OTP : vérification du code ────────────────────────────────────────
router.post('/otp/verify', otpLimiter, async (req, res) => {
  const { phone, code } = z.object({ phone: z.string().max(20), code: z.string().regex(/^\d{6}$/) }).parse(req.body)
  const { full, all } = phoneVariants(phone)

  const otpRecord = await prisma.otpCode.findFirst({
    where: {
      phone: full,
      used: false,
      // Un code émis pour la reprise de brouillon (DRAFT_RECOVERY) ne doit
      // JAMAIS permettre une connexion — filtrage strict par purpose.
      purpose: 'LOGIN',
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

  if (!otpMatches(otpRecord.code, full, 'LOGIN', code)) {
    throw new AppError('ACCESS_DENIED', `Code incorrect. ${2 - otpRecord.attempts} tentative(s) restante(s).`, 401)
  }

  // Marquer le code comme utilisé (conditionnel : un même code ne sert qu'une fois)
  const consumed = await prisma.otpCode.updateMany({ where: { id: otpRecord.id, used: false }, data: { used: true } })
  if (consumed.count !== 1) throw new AppError('ACCESS_DENIED', 'Code OTP invalide ou expiré. Demandez un nouveau code.', 401)

  const users = await prisma.user.findMany({
    where: { isActive: true, OR: [{ phone: { in: all } }, { whatsappPhone: { in: all } }] },
    take: 2,
  })
  if (users.length !== 1) throw new AppError('ACCESS_DENIED', 'Compte introuvable ou désactivé.', 403)
  const [user] = users

  const { accessToken, refreshToken } = await createSessionTokens(user, prisma)

  await audit({
    req, userId: user.id, userName: user.fullName,
    action: 'LOGIN', entityType: 'Session',
    details: { method: 'otp', success: true, role: user.role },
  })

  setAuthCookies(req, res, accessToken, refreshToken)
  res.json({ success: true, data: { user: buildUser(user) } })
})

// ── Google OAuth — email must already exist ───────────────────────────
router.post('/google', authLimiter, async (req, res) => {
  const { idToken } = z.object({ idToken: z.string() }).parse(req.body)

  const client = getGoogleClient()
  if (!client) {
    throw new AppError('SERVER_ERROR', 'Connexion Google non configurée', 503)
  }

  let ticket
  try {
    ticket = await client.verifyIdToken({
      idToken,
      audience: getConfig('GOOGLE_CLIENT_ID'),
    })
  } catch {
    throw new AppError('ACCESS_DENIED', 'Token Google invalide ou expiré', 401)
  }

  const payload = ticket.getPayload()
  if (!payload?.email || !payload.sub) throw new AppError('ACCESS_DENIED', "Impossible de récupérer l'email Google", 401)
  // Adresse non confirmée par Google : n'importe qui pourrait la déclarer
  if (payload.email_verified !== true) {
    throw new AppError('ACCESS_DENIED', 'Adresse Google non vérifiée : confirmez-la auprès de Google ou connectez-vous avec votre mot de passe.', 403)
  }

  // RESTRICTION : l'email doit déjà exister (créé par un admin)
  const user = await prisma.user.findUnique({ where: { email: payload.email.toLowerCase() } })
  if (!user) {
    throw new AppError(
      'ACCESS_DENIED',
      `Aucun compte associé à l'adresse Google ${payload.email}. Vérifiez que vous utilisez le même email que votre compte SGM-CEM, ou demandez à l'administrateur de créer votre compte.`,
      403
    )
  }
  if (!user.isActive) {
    throw new AppError('ACCESS_DENIED', 'Compte désactivé. Contactez l\'administrateur.', 403)
  }
  // Compte rattaché à un identifiant Google : une autre identité Google portant la même adresse est refusée
  if (user.googleSub && user.googleSub !== payload.sub) {
    await audit({ req, userId: user.id, userName: user.fullName, action: 'LOGIN', entityType: 'Session', details: { method: 'google', success: false, reason: 'identifiant Google différent' } })
    throw new AppError('ACCESS_DENIED', 'Ce compte est rattaché à un autre compte Google. Contactez l\'administrateur.', 403)
  }
  if (!user.googleSub) {
    const linked = await prisma.user.updateMany({ where: { id: user.id, googleSub: null }, data: { googleSub: payload.sub } })
    if (linked.count !== 1) throw new AppError('ACCESS_DENIED', 'Ce compte vient d\'être rattaché à un compte Google, réessayez.', 409)
  }

  const { accessToken, refreshToken } = await createSessionTokens(user, prisma)

  await audit({
    req, userId: user.id, userName: user.fullName,
    action: 'LOGIN', entityType: 'Session',
    details: { method: 'google', success: true, role: user.role },
  })

  setAuthCookies(req, res, accessToken, refreshToken)
  res.json({ success: true, data: { user: buildUser(user) } })
})

// ── Change password (forcé 1ère connexion ou volontaire) ──────────────
router.post('/change-password', authenticate, async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string()
      .min(8, 'Le nouveau mot de passe doit contenir au moins 8 caractères')
      .max(128, 'Le mot de passe ne doit pas dépasser 128 caractères')
      .regex(/[A-Z]/, 'Doit contenir au moins une majuscule')
      .regex(/[0-9]/, 'Doit contenir au moins un chiffre'),
  })
  const { currentPassword, newPassword } = schema.parse(req.body)

  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })
  if (!user) throw new AppError('NOT_FOUND', 'Utilisateur introuvable', 404)

  const valid = await verifyPassword(currentPassword, user.passwordHash)
  if (!valid) throw new AppError('ACCESS_DENIED', 'Mot de passe actuel incorrect', 401)

  if (currentPassword === newPassword) {
    throw new AppError('VALIDATION_ERROR', 'Le nouveau mot de passe doit être différent de l\'actuel', 400)
  }

  const passwordHash = await hashPassword(newPassword)
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  })
  // Un mot de passe changé ferme toutes les autres sessions ouvertes
  await revokeUserSessions(user.id, prisma, req.user!.sid)
  forgetUserState(user.id)

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
  const presented: string | undefined = req.cookies?.refresh_token
  if (!presented) throw new AppError('ACCESS_DENIED', 'Session expirée', 401)

  const outcome = await refreshSession(presented, prisma)
  if (!outcome.ok) {
    clearAuthCookies(res)
    if (outcome.reason === 'reused' && outcome.user) {
      // Ancien refresh token rejoué : vol probable → session fermée et tracée
      await audit({
        req, userId: outcome.user.id, userName: outcome.user.fullName, action: 'LOGOUT', entityType: 'Session',
        details: { reason: 'refresh_token_reuse', sessionRevoked: true },
      })
    }
    throw new AppError('ACCESS_DENIED', 'Session expirée', 401)
  }

  setAuthCookies(req, res, outcome.accessToken, outcome.refreshToken)
  res.json({ success: true })
})

// ── Logout ────────────────────────────────────────────────────────────
router.post('/logout', authenticate, async (req, res) => {
  const refreshToken: string | undefined = req.cookies?.refresh_token
  if (refreshToken) {
    const session = await prisma.userSession.findUnique({ where: { refreshToken }, select: { id: true } })
    if (session) await closeActivitySessionForLogout(session.id)
    await revokeSessionByRefreshToken(refreshToken, prisma)
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, fullName: true },
  })
  if (user) {
    await audit({
      req, userId: user.id, userName: user.fullName,
      action: 'LOGOUT', entityType: 'Session',
    })
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
      photoUrl: true,
    },
  })
  if (!user) throw new AppError('NOT_FOUND', 'Utilisateur introuvable', 404)
  // Marqueur d'impersonation (bandeau "Revenir à mon compte" côté web).
  // En impersonation, ne jamais forcer l'écran "changer le mot de passe" du
  // compte cible : c'est le développeur qui navigue, pas l'utilisateur.
  const impersonatedBy = req.user!.impersonatedBy ?? null
  res.json({
    success: true,
    data: {
      ...user,
      impersonatedBy,
      mustChangePassword: impersonatedBy ? false : user.mustChangePassword,
    },
  })
})

// ── Fin d'impersonation — retour au compte DEVELOPER initiateur ───────
router.post('/stop-impersonation', authenticate, async (req, res) => {
  const developerId = req.user!.impersonatedBy
  if (!developerId) {
    throw new AppError('VALIDATION_ERROR', 'Aucune impersonation en cours', 400)
  }

  const developer = await prisma.user.findUnique({ where: { id: developerId } })
  // Sécurité : on ne restaure la session que si l'initiateur est TOUJOURS
  // un DEVELOPER actif (le rôle a pu changer entre-temps).
  if (!developer || !developer.isActive || developer.role !== 'DEVELOPER') {
    clearAuthCookies(res)
    throw new AppError('ACCESS_DENIED', 'Compte développeur initiateur introuvable — reconnectez-vous', 403)
  }

  await prisma.auditLog.create({
    data: {
      userId: developer.id,
      userName: developer.fullName,
      action: 'IMPERSONATE',
      entityType: 'User',
      entityId: req.user!.userId,
      details: { action: 'stop', targetEmail: req.user!.email },
    },
  })

  // Le jeton d'impersonation porte la session du développeur : on la reprend
  const accessToken = signAccessToken({ userId: developer.id, role: developer.role, email: developer.email, sid: req.user!.sid! })
  setAuthCookies(req, res, accessToken)

  res.json({ success: true, data: { user: buildUser(developer) } })
})

export { router as authRouter }
