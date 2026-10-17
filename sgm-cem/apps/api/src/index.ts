import 'dotenv/config'
import './lib/zod-locale'
import http from 'http'
import path from 'path'
import express, { type Request, type Response, type NextFunction, type Router } from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { doubleCsrf } from 'csrf-csrf'
import yeliiWebhookRouter from './webhooks/yelii.webhook'
import cinetpayWebhookRouter from './webhooks/cinetpay.webhook'
import { authRouter } from './routes/auth'
import { membresRouter } from './routes/membres'
import { rubriquesRouter } from './routes/rubriques'
import { contributionsRouter } from './routes/contributions'
import { exportsRouter } from './routes/exports'
import { privacyRouter } from './routes/privacy'
import { maintenanceGuard, maintenanceStatus } from './middleware/maintenance'
import { collecteursRouter } from './routes/collecteurs'
import { collectesRouter } from './routes/collectes'
import { commissionsRouter } from './routes/commissions'
import { prestationsRouter } from './routes/prestations'
import { statsRouter } from './routes/stats'
import { settingsRouter } from './routes/settings'
import { notificationsRouter } from './routes/notifications'
import { profileRouter } from './routes/profile'
import { fundsRouter } from './routes/funds'
import { developerRouter } from './routes/developer'
import { usersRouter } from './routes/users'
import { auditRouter } from './routes/audit'
import { publicRouter } from './routes/public'
import { errorHandler } from './middleware/errorHandler'
import { paymentsRouter } from './routes/payments'
import { activityRouter } from './routes/activity'
import { startScheduledJobs } from './jobs/scheduler'
import { initSocketIO } from './lib/socket'
import { loadConfigCache } from './services/config.service'
import { apiLimiter } from './middleware/rate-limit'
import { randomUUID } from 'crypto'
import pinoHttp from 'pino-http'
import { applyLogLevel, logger } from './lib/logger'
import { initErrorTracking } from './lib/error-tracking'
import { getPrisma } from './lib/prisma'
import { getConfig } from './services/config.service'
import { getCsrfSecret, getTrustProxy } from './lib/security'
import { assertEncryptionKeyForProduction } from './lib/secret-box'

const app = express()
const PORT = process.env.PORT ?? 3001

// Derrière Caddy : req.ip et req.secure reflètent le vrai client (voir lib/security.ts)
app.set('trust proxy', getTrustProxy())
// Express 5 analyse la query string en mode « simple » par défaut : on garde
// l'analyse étendue (qs) d'Express 4, dont dépendent les paramètres existants.
app.set('query parser', 'extended')

initErrorTracking()

// Identifiant de requête : repris de Caddy (X-Request-Id) s'il est bien formé,
// renvoyé au client et présent dans chaque ligne de journal.
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/
app.use(pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers['x-request-id']
    const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID()
    res.setHeader('X-Request-Id', id)
    return id
  },
  customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
  autoLogging: { ignore: req => req.url === '/api/health' || req.url === '/api/activity/heartbeat' },
  serializers: { req: req => ({ id: req.id, method: req.method, url: req.url }), res: res => ({ statusCode: res.statusCode }) },
}))

app.use(helmet())

// Les URL de reçu sont envoyées aux contributeurs et à WhatsApp. Seuls les
// reçus sont publiés localement ; les documents GED restent derrière leurs
// routes authentifiées dédiées.
app.use('/uploads/receipts', express.static(path.join(process.cwd(), 'uploads', 'receipts')))
// Photos de profil (stockage local) : affichées par le web sur une autre origine
app.use('/uploads/avatars', (_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  next()
}, express.static(path.join(process.cwd(), 'uploads', 'avatars'), { dotfiles: 'deny', index: false }))

const allowedOrigins = (process.env.APP_URL ?? 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)

const lanOriginPattern = /^http:\/\/(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)\d+\.\d+:\d+$/

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
    if (process.env.NODE_ENV !== 'production' && lanOriginPattern.test(origin)) return callback(null, true)
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
  // Nom des fichiers téléchargés (exports, données personnelles)
  exposedHeaders: ['Content-Disposition'],
}))
app.use(cookieParser())

// Les webhooks sont montés avant les parseurs globaux : Yelii exige le corps brut.
// Table des montages, exportée pour la matrice RBAC (Express 5 ne garde pas
// le chemin de montage d'un routeur).
export const ROUTE_MOUNTS: Array<[string, Router]> = []
function mount(path: string, router: Router) {
  ROUTE_MOUNTS.push([path, router])
  app.use(path, router)
}

mount('/webhooks', yeliiWebhookRouter)
mount('/webhooks', cinetpayWebhookRouter)

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
// Express 5 laisse req.body à undefined sans corps : les schémas Zod
// (souvent tous champs facultatifs) attendent un objet, comme sous Express 4.
app.use((req, _res, next) => {
  if (req.body === undefined) req.body = {}
  next()
})

app.use('/api/', apiLimiter)

// CSRF — double-submit cookie pattern (secret obligatoire en production)
const csrfSecret = getCsrfSecret()
const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => csrfSecret,
  getSessionIdentifier: (req: Request) => (req.cookies?.access_token ?? '') as string,
  cookieName: 'csrf_token',
  cookieOptions: {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
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

// Mode maintenance : état public (bandeau) et blocage des écritures
app.get('/api/status', (_req, res) => { res.json({ success: true, data: maintenanceStatus() }) })
app.use('/api', maintenanceGuard)

mount('/api/auth', authRouter)
mount('/api/membres', membresRouter)
mount('/api/rubriques', rubriquesRouter)
mount('/api/contributions', contributionsRouter)
mount('/api/exports', exportsRouter)
mount('/api/privacy', privacyRouter)
mount('/api/payments', paymentsRouter)
mount('/api/collecteurs', collecteursRouter)
mount('/api/collectes', collectesRouter)
mount('/api/commissions', commissionsRouter)
mount('/api/prestations', prestationsRouter)
mount('/api/stats', statsRouter)
mount('/api/settings', settingsRouter)
mount('/api/notifications', notificationsRouter)
mount('/api/profile', profileRouter)
mount('/api/funds', fundsRouter)
mount('/api/developer', developerRouter)
mount('/api/users', usersRouter)
mount('/api/audit', auditRouter)
mount('/api/public', publicRouter)
mount('/api/activity', activityRouter)

app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

// Disponibilité réelle (sonde externe, Caddy) : la base répond-elle ?
app.get('/api/health/ready', async (_req, res) => {
  try {
    await getPrisma().$queryRaw`SELECT 1`
    res.json({ status: 'ready', database: 'ok', version: process.env.APP_VERSION ?? 'dev' })
  } catch {
    res.status(503).json({ status: 'unavailable', database: 'injoignable' })
  }
})

app.use(errorHandler)

async function bootstrap(): Promise<void> {
  assertEncryptionKeyForProduction()
  await loadConfigCache()
  applyLogLevel(getConfig('LOG_LEVEL'))
  const server = http.createServer(app)
  initSocketIO(server)
  server.listen(Number(PORT), () => {
    console.log(`✅ SGM-CEM API running on port ${PORT}`)
  })
  // Tâches planifiées : ici par défaut, ou dans le worker (RUN_SCHEDULED_JOBS=false)
  if (process.env.RUN_SCHEDULED_JOBS !== 'false') await startScheduledJobs()
}

if (process.env.NODE_ENV !== 'test') {
  void bootstrap()
}

export default app
