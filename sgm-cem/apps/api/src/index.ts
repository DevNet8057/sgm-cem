import 'dotenv/config'
import 'express-async-errors'
import http from 'http'
import path from 'path'
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
import { developerRouter } from './routes/developer'
import { usersRouter } from './routes/users'
import { auditRouter } from './routes/audit'
import { publicRouter } from './routes/public'
import { errorHandler } from './middleware/errorHandler'
import { paymentsRouter } from './routes/payments'
import { activityRouter } from './routes/activity'
import { startActivityRetentionJob } from './services/activity-write.service'
import { schedulePaymentReconciliation } from './jobs/payment-reconciliation'
import { scheduleMonthlyCron } from './services/cron'
import { initSocketIO } from './lib/socket'
import { loadConfigCache } from './services/config.service'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(helmet())

// Les URL de reçu sont envoyées aux contributeurs et à WhatsApp. Seuls les
// reçus sont publiés localement ; les documents GED restent derrière leurs
// routes authentifiées dédiées.
app.use('/uploads/receipts', express.static(path.join(process.cwd(), 'uploads', 'receipts')))

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
}))
app.use(cookieParser())

// Les webhooks sont montés avant les parseurs globaux : Yelii exige le corps brut.
app.use('/webhooks', yeliiWebhookRouter)
app.use('/webhooks', cinetpayWebhookRouter)

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true })
app.use('/api/', limiter)

// CSRF — double-submit cookie pattern
const csrfSecret = process.env.CSRF_SECRET ?? 'csrf-dev-secret-change-in-prod'
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
app.use('/api/developer', developerRouter)
app.use('/api/users', usersRouter)
app.use('/api/audit', auditRouter)
app.use('/api/public', publicRouter)
app.use('/api/activity', activityRouter)

app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

app.use(errorHandler)

async function bootstrap(): Promise<void> {
  await loadConfigCache()
  startActivityRetentionJob()
  const server = http.createServer(app)
  initSocketIO(server)
  server.listen(Number(PORT), () => {
    console.log(`✅ SGM-CEM API running on port ${PORT}`)
  })
  schedulePaymentReconciliation()
  scheduleMonthlyCron()
}

if (process.env.NODE_ENV !== 'test') {
  void bootstrap()
}

export default app
