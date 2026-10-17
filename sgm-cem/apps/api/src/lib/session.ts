import jwt from 'jsonwebtoken'
import { randomUUID } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import { getPrisma } from './prisma'
import { getJwtSecret, getRefreshTokenSecret } from './security'

export const ACCESS_TTL_SECONDS = 15 * 60
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000
// Fenêtre pendant laquelle l'ancien refresh token reste accepté après rotation
const ROTATION_GRACE_MS = 30_000
// Cache court des contrôles de session : une révocation prend effet en ≤ 10 s
const CHECK_CACHE_MS = 10_000

export interface AccessPayload {
  userId: string
  role: string
  email: string
  sid: string
  impersonatedBy?: string
}

export function signAccessToken(payload: AccessPayload, expiresInSeconds = ACCESS_TTL_SECONDS): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: expiresInSeconds })
}

function signRefreshToken(userId: string, sid: string): string {
  // jti aléatoire : deux jetons émis dans la même seconde restent distincts
  return jwt.sign({ userId, sid }, getRefreshTokenSecret(), { expiresIn: Math.floor(REFRESH_TTL_MS / 1000), jwtid: randomUUID() })
}

/** Ouvre une session (connexion) et renvoie la paire de jetons. */
export async function openSession(user: { id: string; role: string; email: string }, prisma: PrismaClient = getPrisma()) {
  const sid = randomUUID()
  const refreshToken = signRefreshToken(user.id, sid)
  await prisma.userSession.create({
    data: { id: sid, userId: user.id, refreshToken, expiresAt: new Date(Date.now() + REFRESH_TTL_MS) },
  })
  const accessToken = signAccessToken({ userId: user.id, role: user.role, email: user.email, sid })
  return { accessToken, refreshToken, sessionId: sid }
}

export type RefreshOutcome =
  | { ok: true; accessToken: string; refreshToken: string; user: { id: string; role: string; email: string } }
  | { ok: false; reason: 'expired' | 'invalid' | 'reused' | 'inactive'; user?: { id: string; fullName: string } }

/**
 * Rotation : chaque refresh émet un nouveau refresh token. L'ancien, rejoué
 * après la fenêtre de grâce, signe un vol de jeton → la session est révoquée.
 */
export async function refreshSession(presented: string, prisma: PrismaClient = getPrisma()): Promise<RefreshOutcome> {
  try {
    jwt.verify(presented, getRefreshTokenSecret())
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  const now = Date.now()
  let session = await prisma.userSession.findUnique({ where: { refreshToken: presented }, include: { user: true } })
  let graceReplay = false
  if (!session) {
    const previous = await prisma.userSession.findFirst({ where: { previousRefreshToken: presented }, include: { user: true } })
    if (!previous) return { ok: false, reason: 'invalid' }
    if (!previous.rotatedAt || now - previous.rotatedAt.getTime() > ROTATION_GRACE_MS) {
      await revokeSession(previous.id, prisma)
      return { ok: false, reason: 'reused', user: { id: previous.user.id, fullName: previous.user.fullName } }
    }
    session = previous
    graceReplay = true
  }

  if (session.expiresAt.getTime() < now) {
    await revokeSession(session.id, prisma)
    return { ok: false, reason: 'expired' }
  }
  if (!session.user.isActive) {
    await revokeUserSessions(session.userId, prisma)
    return { ok: false, reason: 'inactive' }
  }

  let refreshToken = session.refreshToken
  if (!graceReplay) {
    refreshToken = signRefreshToken(session.userId, session.id)
    await prisma.userSession.update({
      where: { id: session.id },
      data: { refreshToken, previousRefreshToken: presented, rotatedAt: new Date(now) },
    })
  }

  const { user } = session
  const accessToken = signAccessToken({ userId: user.id, role: user.role, email: user.email, sid: session.id })
  return { ok: true, accessToken, refreshToken, user: { id: user.id, role: user.role, email: user.email } }
}

// ── Contrôle à chaque requête authentifiée ────────────────────────────
export interface SessionState {
  valid: boolean
  isActive: boolean
  mustChangePassword: boolean
}

const checkCache = new Map<string, { at: number; state: SessionState }>()

/**
 * `ownerId` = titulaire de la session : l'utilisateur lui-même, ou le
 * DEVELOPER initiateur pendant une impersonation (sa session porte le jeton).
 */
export async function checkSession(sid: string, userId: string, ownerId: string = userId, prisma: PrismaClient = getPrisma()): Promise<SessionState> {
  const key = `${sid}:${userId}`
  const cached = checkCache.get(key)
  if (cached && Date.now() - cached.at < CHECK_CACHE_MS) return cached.state

  const [session, user] = await Promise.all([
    prisma.userSession.findUnique({ where: { id: sid }, select: { expiresAt: true, userId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, mustChangePassword: true } }),
  ])
  const state: SessionState = {
    valid: !!session && session.userId === ownerId && session.expiresAt.getTime() > Date.now() && !!user?.isActive,
    isActive: !!user?.isActive,
    mustChangePassword: !!user?.mustChangePassword,
  }
  if (checkCache.size > 5000) checkCache.clear()
  checkCache.set(key, { at: Date.now(), state })
  return state
}

function forgetCached(predicate: (key: string) => boolean): void {
  for (const key of checkCache.keys()) if (predicate(key)) checkCache.delete(key)
}

export async function revokeSession(sid: string, prisma: PrismaClient = getPrisma()): Promise<void> {
  await prisma.userSession.deleteMany({ where: { id: sid } })
  forgetCached(key => key.startsWith(`${sid}:`))
}

/** Révocation par refresh token (déconnexion). Renvoie l'id de session fermée. */
export async function revokeSessionByRefreshToken(refreshToken: string, prisma: PrismaClient = getPrisma()): Promise<string | null> {
  const session = await prisma.userSession.findUnique({ where: { refreshToken }, select: { id: true } })
  if (!session) return null
  await revokeSession(session.id, prisma)
  return session.id
}

/** Ferme toutes les sessions d'un compte (sauf éventuellement la session courante). */
export async function revokeUserSessions(userId: string, prisma: PrismaClient = getPrisma(), exceptSid?: string): Promise<void> {
  const sessions = await prisma.userSession.findMany({ where: { userId }, select: { id: true } })
  const revoked = new Set(sessions.map(s => s.id).filter(id => id !== exceptSid))
  await prisma.userSession.deleteMany({ where: { id: { in: [...revoked] } } })
  forgetCached(key => revoked.has(key.split(':')[0]) || (key.endsWith(`:${userId}`) && !key.startsWith(`${exceptSid}:`)))
}

/** À appeler quand le rôle, l'état actif ou l'obligation de changer le mot de passe change. */
export function forgetUserState(userId: string): void {
  forgetCached(key => key.endsWith(`:${userId}`))
}
