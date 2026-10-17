// Droits des personnes (lot 4.6 — EF-M17-03/04) : téléchargement de ses
// données, anonymisation d'un ancien compte par un administrateur.
import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { limiter, userOrIpKey } from '../middleware/rate-limit'
import { verifyPassword } from '../lib/password'
import { getPrisma } from '../lib/prisma'
import { audit } from '../services/audit.service'
import { anonymizeUser, buildPersonalDataExport, checkAnonymization } from '../services/privacy.service'

const router = Router()
const prisma = getPrisma()

// GET /api/privacy/my-data — droit d'accès et de portabilité (tout compte connecté)
router.get('/my-data', authenticate, requireLevel(1), async (req, res) => {
  const data = await buildPersonalDataExport(req.user!.userId)
  await audit({ req, userId: req.user!.userId, userName: req.user!.email, action: 'EXPORT', entityType: 'DonneesPersonnelles', entityId: req.user!.userId })
  const day = new Date().toLocaleDateString('fr-CA', { timeZone: 'Africa/Douala' })
  res.setHeader('Content-Disposition', `attachment; filename="mes-donnees-sgm-cem-${day}.json"`)
  res.setHeader('Cache-Control', 'no-store')
  res.type('application/json').send(JSON.stringify(data, null, 2))
})

async function targetOf(id: string, actorId: string) {
  if (id === actorId) throw new AppError('BUSINESS_RULE', 'Vous ne pouvez pas anonymiser votre propre compte.', 400)
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, memberId: true } })
  if (!user) throw new AppError('NOT_FOUND', 'Utilisateur introuvable', 404)
  return user
}

// GET /api/privacy/users/:id/anonymization — ce qui empêche encore l'anonymisation
router.get('/users/:id/anonymization', authenticate, requireLevel(5), async (req, res) => {
  const user = await targetOf(String(req.params.id), req.user!.userId)
  const check = await checkAnonymization(user.id)
  res.json({ success: true, data: { ...check, possible: check.blockers.length === 0 } })
})

// POST /api/privacy/users/:id/anonymize — irréversible : mot de passe ressaisi
// et confirmation écrite exigés, conditions revérifiées côté serveur
const anonymizeLimiter = limiter(15 * 60 * 1000, 5, 'Trop de tentatives. Réessayez dans 15 minutes.', { keyGenerator: userOrIpKey })
router.post('/users/:id/anonymize', authenticate, requireLevel(5), anonymizeLimiter, async (req, res) => {
  const { password } = z.object({
    password: z.string().min(1, 'Mot de passe requis'),
    confirmation: z.literal('ANONYMISER', { error: 'Tapez ANONYMISER pour confirmer' }),
  }).parse(req.body)
  const user = await targetOf(String(req.params.id), req.user!.userId)

  const account = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { passwordHash: true } })
  if (!(await verifyPassword(password, account?.passwordHash))) {
    await audit({ req, userId: req.user!.userId, userName: req.user!.email, action: 'ANONYMIZE', entityType: 'User', entityId: user.id, details: { refus: 'mot de passe incorrect' } })
    throw new AppError('INVALID_CREDENTIALS', 'Mot de passe incorrect', 403)
  }
  const check = await checkAnonymization(user.id)
  if (check.blockers.length > 0) throw new AppError('BUSINESS_RULE', check.blockers.join(' '), 400)

  const result = await anonymizeUser(user.id)
  await audit({
    req, userId: req.user!.userId, userName: req.user!.email, action: 'ANONYMIZE', entityType: 'User', entityId: user.id,
    details: { matricule: result.memberId, derniereActivite: check.lastActivityAt.toISOString(), delaiMois: check.delayMonths },
  }, { strict: true })
  res.json({ success: true, data: { id: user.id, memberId: result.memberId } })
})

export { router as privacyRouter }
