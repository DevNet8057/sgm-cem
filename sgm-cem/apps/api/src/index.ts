import 'dotenv/config'
import 'express-async-errors'
import path from 'path'
import http from 'http'
import express, { type Request, type Response, type NextFunction } from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { doubleCsrf } from 'csrf-csrf'
import yeliiWebhookRouter from './webhooks/yelii.webhook'
import cinetpayWebhookRouter from './webhooks/cinetpay.webhook'
import { authRouter } from './routes/auth'
import { membresRouter } from './routes/membres'
import { rubriquesRouter } from './routes/rubriques'
import { contributionsRouter } from './routes/contributions'
import { collecteursRouter } from './routes/collecteurs'
import { collectesRouter } from './routes/collectes'
import { commissionsRouter } from './routes/commissions'
import { prestationsRouter } from './routes/prestations'
import { statsRouter } from './routes/stats'
import { settingsRouter } from './routes/settings'
import { notificationsRouter } from './routes/notifications'
import { profileRouter } from './routes/profile'
import { fundsRouter } from './routes/funds'
import { webhooksRouter } from './routes/webhooks'
import { developerRouter } from './routes/developer'
import { usersRouter } from './routes/users'
import { auditRouter } from './routes/audit'
import { publicRouter } from './routes/public'
import { errorHandler } from './middleware/errorHandler'
import { paymentsRouter } from './routes/payments'
import { schedulePaymentReconciliation } from './jobs/payment-reconciliation'
import { scheduleMonthlyCron } from './services/cron'
import { loadConfigCache, getConfig, getConfigBool } from './services/config.service'
import { initSocketIO } from './lib/socket'

const app = express()
// Trust first proxy (Render, Heroku, etc.) — requis pour que
// express-rate-limit utilise X-Forwarded-For et non l'IP du proxy.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1)
const PORT = process.env.PORT ?? 3001

// CSP étendu pour autoriser Google Identity Services (OAuth)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com"],
      connectSrc: ["'self'", "https://accounts.google.com", "https://oauth2.googleapis.com"],
      frameSrc: ["https://accounts.google.com"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "data:"],
    },
  },
}))

const lanOriginPattern = /^http:\/\/(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)\d+\.\d+:\d+$/
// En dev, le lanceur (scripts/dev.mjs) peut placer le web sur un port ≠ 3000 :
// on accepte donc toute origine localhost hors production.
const localOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/

app.use(cors({
  origin: (origin, callback) => {
    // Origines lues à CHAQUE requête via getConfig — modifiables depuis le
    // panneau développeur (APP_URL, section D) sans redémarrage.
    const allowedOrigins = (getConfig('APP_URL') ?? 'http://localhost:3000')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
    if (process.env.NODE_ENV !== 'production' && (lanOriginPattern.test(origin) || localOriginPattern.test(origin))) return callback(null, true)
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
}))
app.use(cookieParser())

// CRITICAL: Les webhooks doivent être enregistrés AVANT express.json()
// Yelii : raw body requis pour vérification HMAC-SHA512
// CinetPay : urlencoded parsé au niveau de la route, pas affecté par express.json()
app.use('/webhooks', yeliiWebhookRouter)
app.use('/webhooks', cinetpayWebhookRouter)

// Fichiers stockés localement (avatars, etc.) quand aucun S3 n'est configuré —
// voir services/storage.ts : storeFile() écrit ici et renvoie ${API_URL}/uploads/<key>.
// Helmet pose Cross-Origin-Resource-Policy: same-origin par défaut, ce qui fait
// bloquer par le navigateur les <img> du web (APP_URL:3000) vers l'API (:3001).
// On relâche UNIQUEMENT ici : /uploads est déjà public et non authentifié,
// le reste de l'API conserve le CORP same-origin de helmet.
app.use(
  '/uploads',
  (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    next()
  },
  express.static(path.join(process.cwd(), 'uploads'))
)

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Protection d'infrastructure — désactivée sous vitest : la suite partage une
// seule instance Express (isolate:false) et son cumul de requêtes dépasserait
// le budget, faisant échouer des tests sans rapport. Les limiteurs MÉTIER
// (otpLimiter, publicLimiter…) restent actifs partout, tests compris.
// 600/15min : l'app est bavarde par conception (polling statut paiement 5 s,
// autosave brouillons, dashboard) — à 100, un utilisateur actif + la page
// publique épuisaient le budget IP et TOUT passait en 429 (y compris /login,
// vécu comme « déconnecté, impossible de se reconnecter »). Les routes
// sensibles gardent leurs limiteurs stricts (authLimiter 10/h, otpLimiter
// 5/10min, publicLimiter 30/15min).
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true })
if (process.env.NODE_ENV !== 'test') app.use('/api/', limiter)

// CSRF — double-submit cookie pattern
const csrfSecret = process.env.CSRF_SECRET ?? 'csrf-dev-secret-change-in-prod'
const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => csrfSecret,
  getSessionIdentifier: (req: Request) => (req.cookies?.access_token ?? '') as string,
  cookieName: 'csrf_token',
  cookieOptions: {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/',
  },
  getCsrfTokenFromRequest: (req: Request) => req.headers['x-csrf-token'] as string | undefined,
})

app.get('/api/csrf-token', (req, res) => {
  const token = generateCsrfToken(req, res)
  res.json({ token })
})

app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/webhooks')) return next()
  if (req.path === '/csrf-token') return next()
  if (req.path === '/auth/google') return next()
  doubleCsrfProtection(req, res, next)
})

// Mode maintenance (panneau développeur, section D) — évalué à chaque requête.
// Auth + panneau développeur + health restent accessibles pour pouvoir le désactiver.
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (!getConfigBool('MAINTENANCE_MODE', false)) return next()
  if (
    req.path.startsWith('/auth') ||
    req.path.startsWith('/developer') ||
    req.path === '/csrf-token' ||
    req.path === '/health'
  ) return next()
  res.status(503).json({
    success: false,
    error: {
      code: 'MAINTENANCE',
      message: getConfig('MAINTENANCE_MESSAGE') ?? 'Maintenance en cours — merci de réessayer dans quelques minutes.',
    },
  })
})

app.use('/api/auth', authRouter)
app.use('/api/membres', membresRouter)
app.use('/api/rubriques', rubriquesRouter)
app.use('/api/contributions', contributionsRouter)
app.use('/api/payments', paymentsRouter)
app.use('/api/collecteurs', collecteursRouter)
app.use('/api/collectes', collectesRouter)
app.use('/api/commissions', commissionsRouter)
app.use('/api/prestations', prestationsRouter)
app.use('/api/stats', statsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/profile', profileRouter)
app.use('/api/funds', fundsRouter)
app.use('/api/webhooks', webhooksRouter)
app.use('/api/developer', developerRouter) // panneau développeur — requireDeveloper strict
app.use('/api/users', usersRouter) // gestion des comptes (ADMIN/DEVELOPER) — n'était jamais monté (fix 2026-07-05)
app.use('/api/audit', auditRouter) // journal « qui a fait quoi » — périmètre filtré par rôle dans la route
app.use('/api/public', publicRouter) // collecte publique — AUCUNE authentification, limiteurs par-route dans le fichier

app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

app.use(errorHandler)

if (process.env.NODE_ENV !== 'test') {
  // Serveur HTTP explicite pour porter Socket.IO (temps réel — voir lib/socket.ts)
  // en plus d'Express. En test, aucun serveur ni socket n'est démarré (handles
  // ouverts, EADDRINUSE) — la suite supertest s'appuie uniquement sur `app`.
  const server = http.createServer(app)
  initSocketIO(server)

  // Charger la configuration technique depuis la base AVANT d'accepter du trafic
  // (DEVELOPER_PANEL_SGM_CEM.md §3 — la DB est la source de vérité à l'exécution)
  void loadConfigCache().finally(() => {
    server.listen(PORT, () => {
      console.log(`✅ SGM-CEM API running on port ${PORT}`)
    })
    schedulePaymentReconciliation()
    scheduleMonthlyCron()
  })
}

export default app
