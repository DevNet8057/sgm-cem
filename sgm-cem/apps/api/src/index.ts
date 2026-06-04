import 'dotenv/config'
import 'express-async-errors'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
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
app.use(cors({
  origin: process.env.APP_URL ?? 'http://localhost:3000',
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true })
app.use('/api/', limiter)

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
