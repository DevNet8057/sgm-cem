import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { getPrisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { endActivityTab, recordActivityHeartbeat, resolveBrowserActivityContext } from '../services/activity-write.service'
import { isActivityPageKey } from '@sgm-cem/shared'

const router = Router()
const prisma = getPrisma()
const heartbeatLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, keyGenerator: req => req.user?.userId ?? req.ip ?? 'unknown', message: { success: false, error: { code: 'RATE_LIMITED', message: 'Trop de télémétrie' } } })
const heartbeat = z.object({ tabId: z.string().uuid(), seq: z.number().int().min(0), pageKey: z.string(), isActive: z.boolean() })
const ending = z.object({ tabId: z.string().uuid(), seq: z.number().int().min(0) })
const pagination = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) })
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

async function browserContext(req: Parameters<typeof authenticate>[0]) {
  const context = await resolveBrowserActivityContext(req)
  if (typeof context === 'string') return null
  return context
}

async function admin(req: Parameters<typeof authenticate>[0]) {
  if (!req.user?.userId) throw new AppError('ACCESS_DENIED', 'Authentification requise', 401)
  const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { role: true, isActive: true } })
  if (!user?.isActive || !['ADMIN', 'DEVELOPER'].includes(user.role)) throw new AppError('INSUFFICIENT_PERMISSIONS', 'Rôle administrateur requis', 403)
  return user
}

router.post('/heartbeat', authenticate, heartbeatLimiter, async (req, res) => {
  const context = await browserContext(req)
  if (!context) return res.json({ success: true, data: { accepted: false, reason: 'NO_BROWSER_SESSION', serverTime: new Date().toISOString() } })
  const input = heartbeat.parse(req.body)
  if (!isActivityPageKey(input.pageKey)) throw new AppError('VALIDATION_ERROR', "Page d'activité inconnue", 400)
  const result = await recordActivityHeartbeat(context, { ...input, pageKey: input.pageKey })
  res.json({ success: true, data: result })
})

router.post('/end', authenticate, heartbeatLimiter, async (req, res) => {
  const context = await browserContext(req)
  if (!context) return res.json({ success: true, data: { accepted: false, reason: 'NO_BROWSER_SESSION', serverTime: new Date().toISOString() } })
  res.json({ success: true, data: await endActivityTab(context, ending.parse(req.body)) })
})

router.get('/overview', authenticate, async (req, res) => {
  await admin(req)
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 7
  const from = new Date(Date.now() - days * 86400000)
  const [sessions, actions, pages] = await Promise.all([
    prisma.activitySession.findMany({ where: { startedAt: { gte: from } }, select: { userId: true, activeSeconds: true, endedAt: true, authExpiresAt: true, lastSeenAt: true } }),
    prisma.auditLog.findMany({ where: { createdAt: { gte: from } }, select: { userId: true, action: true, createdAt: true } }),
    prisma.activityPageAggregate.findMany({ where: { day: { gte: from } }, select: { pageKey: true, activeSeconds: true, session: { select: { userId: true } } } }),
  ])
  const now = Date.now(); const online = new Set(sessions.filter(s => !s.endedAt && now - s.lastSeenAt.getTime() < 90_000).map(s => s.userId))
  const byPage = new Map<string, { activeSeconds: number; users: Set<string> }>()
  for (const p of pages) { const x = byPage.get(p.pageKey) ?? { activeSeconds: 0, users: new Set<string>() }; x.activeSeconds += p.activeSeconds; x.users.add(p.session.userId); byPage.set(p.pageKey, x) }
  res.json({ success: true, data: { range: { days, from: from.toISOString(), to: new Date().toISOString() }, presence: { onlineUsers: online.size, offlineUsers: 0, activeAccounts: new Set(sessions.map(s => s.userId)).size }, sessions: { started: sessions.length, explicitLogouts: sessions.filter(s => !!s.endedAt).length, expired: sessions.filter(s => !s.endedAt && s.authExpiresAt < new Date()).length, activeSeconds: sessions.reduce((n, s) => n + s.activeSeconds, 0), averageActiveSeconds: sessions.length ? Math.round(sessions.reduce((n, s) => n + s.activeSeconds, 0) / sessions.length) : 0 }, actions: { total: actions.length, failedLogins: 0 }, topPages: [...byPage].sort((a, b) => b[1].activeSeconds - a[1].activeSeconds).slice(0, 10).map(([pageKey, x]) => ({ pageKey, activeSeconds: x.activeSeconds, uniqueUsers: x.users.size })), daily: [] } })
})

router.get('/users', authenticate, async (req, res) => {
  await admin(req); const { page, pageSize } = pagination.parse(req.query); const skip = (page - 1) * pageSize
  const [users, total, sessions, actions] = await Promise.all([prisma.user.findMany({ skip, take: pageSize, select: { id: true, fullName: true, role: true, isActive: true, lastLoginAt: true }, orderBy: { fullName: 'asc' } }), prisma.user.count(), prisma.activitySession.findMany({ select: { userId: true, activeSeconds: true, endedAt: true, lastSeenAt: true } }), prisma.auditLog.findMany({ select: { userId: true } })])
  const data = users.map(u => { const ss = sessions.filter(s => s.userId === u.id); return { userId: u.id, fullName: u.fullName, role: u.role, isActive: u.isActive, presence: ss.some(s => !s.endedAt && Date.now() - s.lastSeenAt.getTime() < 90000) ? 'ONLINE' : 'OFFLINE', lastSeenAt: ss.sort((a,b) => b.lastSeenAt.getTime()-a.lastSeenAt.getTime())[0]?.lastSeenAt.toISOString() ?? u.lastLoginAt?.toISOString() ?? null, openSessions: ss.filter(s => !s.endedAt).length, sessions: ss.length, activeSeconds: ss.reduce((n,s) => n+s.activeSeconds,0), actions: actions.filter(a => a.userId === u.id).length, failedLogins: 0 } })
  res.json({ success: true, data: { items: data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } })
})

router.get('/sessions', authenticate, async (req, res) => {
  await admin(req)
  const { page, pageSize } = pagination.parse(req.query)
  const [sessions, total] = await Promise.all([
    prisma.activitySession.findMany({ orderBy: { lastSeenAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { tabs: true, pageAggregates: true } }),
    prisma.activitySession.count(),
  ])
  const users = await prisma.user.findMany({ where: { id: { in: sessions.map(session => session.userId) } }, select: { id: true, fullName: true, role: true } })
  const usersById = new Map(users.map(user => [user.id, user]))
  const now = Date.now()
  const items = sessions.map(session => {
    const user = usersById.get(session.userId)
    const state = session.endedAt ? 'LOGGED_OUT' : session.authExpiresAt.getTime() < now ? 'EXPIRED' : now - session.lastSeenAt.getTime() < 90_000 ? 'ONLINE' : 'INACTIVE'
    return {
      id: session.id, userId: session.userId, userName: user?.fullName ?? 'Utilisateur supprimé', role: user?.role ?? 'INCONNU',
      startedAt: session.startedAt.toISOString(), lastSeenAt: session.lastSeenAt.toISOString(), lastActiveAt: session.lastActiveAt?.toISOString() ?? null, endedAt: session.endedAt?.toISOString() ?? null, authExpiresAt: session.authExpiresAt.toISOString(), state, activeSeconds: session.activeSeconds,
      tabs: session.tabs.map(tab => ({ tabId: tab.tabId, pageKey: tab.pageKey, isActive: tab.isActive, lastSeenAt: tab.lastSeenAt.toISOString(), endedAt: tab.endedAt?.toISOString() ?? null })),
      pages: session.pageAggregates.map(aggregate => ({ day: aggregate.day.toISOString(), pageKey: aggregate.pageKey, activeSeconds: aggregate.activeSeconds })),
    }
  })
  res.json({ success: true, data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } })
})

router.get('/actions', authenticate, async (req, res) => {
  await admin(req)
  const { page, pageSize } = pagination.parse(req.query)
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, userId: true, userName: true, action: true, entityType: true, createdAt: true } }),
    prisma.auditLog.count(),
  ])
  res.json({ success: true, data: { items: items.map(item => ({ id: item.id, userId: item.userId, userName: item.userName, role: '', action: item.action, entityType: item.entityType, occurredAt: item.createdAt.toISOString(), success: null })), total, page, pageSize, totalPages: Math.ceil(total / pageSize) } })
})

export { router as activityRouter }
