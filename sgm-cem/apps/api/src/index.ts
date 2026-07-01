import 'dotenv/config'
import 'express-async-errors'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { doubleCsrfProtection, generateCsrfToken } from 'csrf-csrf'
import { authRouter } from './routes/auth'
import { membresRouter } from './routes/membres'
import { rubriquesRouter } from './routes/rubriques'
import { contributionsRouter } from './routes/contributions'
import { collecteursRouter } from './routes/collecteurs'
import { commissionsRouter } from './routes/commissions'
import { prestationsRouter } from './routes/prestations'
import { statsRouter } from './routes/stats'
import { settingsRouter } from './routes/settings'
import { notificationsRouter } from './routes/notifications'
import { errorHandler } from './middleware/errorHandler'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(helmet())

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
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true })
app.use('/api/', limiter)

// CSRF — double-submit cookie pattern
const csrfSecret = process.env.CSRF_SECRET ?? 'csrf-dev-secret-change-in-prod'
const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => csrfSecret,
  getSessionIdentifier: (req) => (req.cookies?.access_token ?? '') as string,
  cookieName: 'csrf_token',
  cookieOptions: {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  },
  getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'] as string | undefined,
})

app.get('/api/csrf-token', (req, res) => {
  const token = generateCsrfToken(req, res)
  res.json({ token })
})

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/webhooks')) return next()
  if (req.path === '/csrf-token') return next()
  if (req.path === '/auth/google') return next()
  doubleCsrfProtection(req, res, next)
})

app.use('/api/auth', authRouter)
app.use('/api/membres', membresRouter)
app.use('/api/rubriques', rubriquesRouter)
app.use('/api/contributions', contributionsRouter)
app.use('/api/collecteurs', collecteursRouter)
app.use('/api/commissions', commissionsRouter)
app.use('/api/prestations', prestationsRouter)
app.use('/api/stats', statsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/notifications', notificationsRouter)

app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`✅ SGM-CEM API running on port ${PORT}`)
})

export default app
