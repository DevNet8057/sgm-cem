// ──────────────────────────────────────────────────────────────────────
// PANNEAU DÉVELOPPEUR — routes de configuration technique
// DEVELOPER_PANEL_SGM_CEM.md §4-§5
//
// RÈGLE D'ACCÈS STRICTE : toutes les routes utilisent requireDeveloper,
// JAMAIS requireLevel(5) — même ADMIN ne doit pas y accéder.
// ──────────────────────────────────────────────────────────────────────
import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import { authenticate } from '../middleware/auth'
import { requireDeveloper } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { getPrisma } from '../lib/prisma'
import { getJwtSecret } from '../lib/security'
import { updateConfig, getConfigHistory, EXCLUDED_KEYS } from '../services/config.service'
import { getYeliiWalletBalance } from '../services/yelii.service'
import { setAuthCookies } from './auth'

const router = Router()
const prisma = getPrisma()

// Toutes les routes du panneau : authentification + rôle DEVELOPER exact
router.use(authenticate, requireDeveloper)

const MASK = '••••••••'

/** Récupère l'identité complète du développeur connecté (le JWT ne porte pas fullName). */
async function getRequester(userId: string): Promise<{ id: string; fullName: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true } })
  if (!user) throw new AppError('NOT_FOUND', 'Utilisateur introuvable', 404)
  return user
}

// ── GET /api/developer/config — toute la config, groupée, secrets masqués ──
router.get('/config', async (_req, res) => {
  const configs = await prisma.systemConfig.findMany({
    orderBy: [{ category: 'asc' }, { label: 'asc' }],
  })
  const data = configs.map(c => ({
    key: c.key,
    value: c.isSecret ? MASK : c.value,
    category: c.category,
    label: c.label,
    description: c.description,
    isSecret: c.isSecret,
    isEditable: c.isEditable,
    updatedAt: c.updatedAt,
    updatedBy: c.updatedBy,
  }))
  res.json({ success: true, data })
})

// ── PUT /api/developer/config/:key — modifier une valeur ──────────────
router.put('/config/:key', async (req, res) => {
  const key = String(req.params.key)
  const { value, reason } = z.object({
    value: z.string(),
    reason: z.string().max(500).optional(),
  }).parse(req.body)

  if (EXCLUDED_KEYS.has(key)) {
    throw new AppError('FORBIDDEN', `${key} est un secret d'authentification — modifiable uniquement via .env`, 403)
  }

  const existing = await prisma.systemConfig.findUnique({ where: { key } })
  if (!existing) throw new AppError('NOT_FOUND', `Clé de configuration inconnue : ${key}`, 404)
  if (!existing.isEditable) throw new AppError('FORBIDDEN', `${key} n'est pas éditable manuellement`, 403)

  const requester = await getRequester(req.user!.userId)
  await updateConfig(key, value, requester, reason)

  res.json({
    success: true,
    data: { key, value: existing.isSecret ? MASK : value },
    message: `${existing.label} mis à jour — effet immédiat, sans redémarrage.`,
  })
})

// ── POST /api/developer/config/:key/reveal — afficher un secret (audité) ──
router.post('/config/:key/reveal', async (req, res) => {
  const key = String(req.params.key)
  const config = await prisma.systemConfig.findUnique({ where: { key } })
  if (!config) throw new AppError('NOT_FOUND', `Clé inconnue : ${key}`, 404)

  const requester = await getRequester(req.user!.userId)
  // Chaque révélation d'un secret est tracée dans l'audit général
  await prisma.auditLog.create({
    data: {
      userId: requester.id,
      userName: requester.fullName,
      action: 'DEVELOPER_PANEL_CONFIG_CHANGED',
      entityType: 'SystemConfig',
      entityId: key,
      details: { action: 'reveal_secret' },
    },
  })

  res.json({ success: true, data: { key, value: config.value } })
})

// ── GET /api/developer/config/:key/history — historique d'une clé ─────
router.get('/config/:key/history', async (req, res) => {
  const key = String(req.params.key)
  const history = await getConfigHistory(key)
  const config = await prisma.systemConfig.findUnique({ where: { key }, select: { isSecret: true } })
  // Ne jamais renvoyer les valeurs en clair pour une clé secrète
  const data = config?.isSecret
    ? history.map(h => ({ ...h, oldValue: h.oldValue ? MASK : null, newValue: MASK }))
    : history
  res.json({ success: true, data })
})

// ── POST /api/developer/config/webhook/recalculate — cas d'usage §4 ───
router.post('/config/webhook/recalculate', async (req, res) => {
  const { newBaseUrl, reason } = z.object({
    newBaseUrl: z.string().url('URL invalide — inclure le protocole (https://…)'),
    reason: z.string().max(500).optional(),
  }).parse(req.body)

  // 1. Nettoyer l'URL (retirer un éventuel slash final)
  const cleanBase = newBaseUrl.replace(/\/$/, '')

  // 2. Construire l'URL complète du webhook (montée à la racine du serveur,
  //    AVANT express.json — voir index.ts)
  const fullWebhookUrl = `${cleanBase}/webhooks/yelii`

  // 3. Enregistrer en base + historique + audit (effet immédiat via le cache)
  const requester = await getRequester(req.user!.userId)
  await updateConfig('YELII_WEBHOOK_URL', fullWebhookUrl, requester, reason, {
    category: 'WEBHOOKS', label: 'URL Webhook Yelii',
  })

  // 4. Yelii ne propose pas d'API de mise à jour du webhook global —
  //    rappel d'action manuelle dans la réponse.
  res.json({
    success: true,
    data: {
      webhookUrl: fullWebhookUrl,
      manualActionRequired:
        'Copiez cette URL dans le tableau de bord Yelii (https://api.yelii.xyz/dashboard) si un champ webhook global y est configuré.',
    },
  })
})

// ── POST /api/developer/config/test/yelii — tester la clé API Yelii ───
router.post('/config/test/yelii', async (_req, res) => {
  const result = await getYeliiWalletBalance()
  res.json({ success: result.ok, data: result })
})

// ── POST /api/developer/impersonate/:userId — se connecter en tant que ─
// Outil développeur : bascule la session courante vers le compte cible.
// • Réservé DEVELOPER (router.use requireDeveloper)
// • Jeton borné à 1 h, marqué `impersonatedBy` (bandeau + retour en un clic)
// • Chaque bascule est auditée (AuditAction.IMPERSONATE)
// • Le refresh_token du développeur reste en place : à l'expiration du jeton,
//   la session retombe automatiquement sur le compte développeur.
const IMPERSONATION_MAX_AGE_MS = 60 * 60 * 1000 // 1 heure

router.post('/impersonate/:userId', async (req, res) => {
  const targetId = String(req.params.userId)

  if (targetId === req.user!.userId) {
    throw new AppError('VALIDATION_ERROR', 'Vous êtes déjà connecté à ce compte', 400)
  }

  const target = await prisma.user.findUnique({ where: { id: targetId } })
  if (!target) throw new AppError('NOT_FOUND', 'Utilisateur introuvable', 404)
  if (!target.isActive) {
    throw new AppError('VALIDATION_ERROR', 'Compte désactivé — impossible de s\'y connecter', 400)
  }
  if (target.role === 'DEVELOPER') {
    throw new AppError('FORBIDDEN', 'Impossible d\'impersoner un autre compte DEVELOPER', 403)
  }

  const requester = await getRequester(req.user!.userId)
  await prisma.auditLog.create({
    data: {
      userId: requester.id,
      userName: requester.fullName,
      action: 'IMPERSONATE',
      entityType: 'User',
      entityId: target.id,
      details: { action: 'start', targetEmail: target.email, targetRole: target.role },
    },
  })

  // Jeton du compte cible, marqué de l'identité du développeur initiateur
  const payload = {
    userId: target.id,
    role: target.role,
    email: target.email,
    impersonatedBy: requester.id,
  }
  const accessToken = jwt.sign(payload, getJwtSecret(), { expiresIn: '1h' })
  setAuthCookies(res, accessToken, undefined, IMPERSONATION_MAX_AGE_MS)

  res.json({
    success: true,
    data: {
      user: {
        id: target.id,
        firstName: target.firstName,
        lastName: target.lastName,
        fullName: target.fullName,
        email: target.email,
        role: target.role,
        mustChangePassword: false, // ne pas déclencher l'écran de changement de mdp pour le dev
      },
      impersonatedBy: requester.id,
    },
    message: `Connecté en tant que ${target.fullName} (${target.role}) — durée max 1 h.`,
  })
})

export { router as developerRouter }
