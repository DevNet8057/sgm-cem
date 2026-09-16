import type { Request } from 'express'
import type { Prisma } from '@prisma/client'
import {
  isActivityPageKey,
  type ActivityEndInput,
  type ActivityHeartbeatInput,
  type ActivityIngestRejection,
  type ActivityIngestResult,
  type ActivityPageKey,
} from '@sgm-cem/shared'
import { AppError } from '../middleware/errorHandler'
import { getPrisma } from '../lib/prisma'
import { getConfigNumber } from './config.service'

const prisma = getPrisma()
const MAX_TABS_PER_SESSION = 100
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000

let retentionTimer: NodeJS.Timeout | null = null

export interface BrowserActivityContext {
  userId: string
  authSessionId: string
  authSessionCreatedAt: Date
  authSessionExpiresAt: Date
}

export interface ActivityCredit {
  seconds: number
  from: Date
  to: Date
}

export interface ActivityDaySlice {
  day: Date
  seconds: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function maxDate(...dates: Date[]): Date {
  return new Date(Math.max(...dates.map(date => date.getTime())))
}

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function activityLimits(): { maxCreditSeconds: number; offlineSeconds: number } {
  const maxCreditSeconds = clamp(
    Math.trunc(getConfigNumber('ACTIVITY_MAX_CREDIT_SECONDS', 45)),
    1,
    60,
  )
  const offlineSeconds = clamp(
    Math.trunc(getConfigNumber('ACTIVITY_OFFLINE_SECONDS', 90)),
    Math.max(maxCreditSeconds, 30),
    300,
  )
  return { maxCreditSeconds, offlineSeconds }
}

/**
 * Calcule la tranche encore créditable pour une session entière.
 * Le curseur de session empêche deux onglets de créditer la même seconde.
 */
export function calculateActivityCredit(params: {
  previousTabIsActive: boolean
  previousTabLastSeenAt: Date
  sessionLastAccountedAt: Date
  now: Date
  maxCreditSeconds: number
}): ActivityCredit | null {
  if (!params.previousTabIsActive) return null

  const nowMs = params.now.getTime()
  const eligibleFromMs = Math.max(
    params.previousTabLastSeenAt.getTime(),
    params.sessionLastAccountedAt.getTime(),
    nowMs - params.maxCreditSeconds * 1000,
  )
  const seconds = Math.floor((nowMs - eligibleFromMs) / 1000)
  if (seconds <= 0) return null

  // Aligner la tranche sur un nombre entier de secondes garantit que la
  // ventilation journalière conserve exactement le total crédité.
  return {
    seconds,
    from: new Date(nowMs - seconds * 1000),
    to: new Date(nowMs),
  }
}

/** Ventile une tranche active entre les jours UTC qu'elle traverse. */
export function splitActivityInterval(from: Date, to: Date): ActivityDaySlice[] {
  const totalSeconds = Math.floor((to.getTime() - from.getTime()) / 1000)
  if (totalSeconds <= 0) return []

  const slices: ActivityDaySlice[] = []
  let cursor = new Date(from)
  let assignedSeconds = 0

  while (cursor < to) {
    const nextMidnight = new Date(Date.UTC(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth(),
      cursor.getUTCDate() + 1,
    ))
    const segmentEnd = nextMidnight < to ? nextMidnight : to
    const isLast = segmentEnd.getTime() === to.getTime()
    const seconds = isLast
      ? totalSeconds - assignedSeconds
      : Math.floor((segmentEnd.getTime() - cursor.getTime()) / 1000)

    if (seconds > 0) {
      slices.push({ day: utcDay(cursor), seconds })
      assignedSeconds += seconds
    }
    cursor = segmentEnd
  }

  return slices
}

function ingestResult(
  now: Date,
  accepted: boolean,
  sessionId?: string,
  reason?: ActivityIngestRejection,
): ActivityIngestResult {
  const { offlineSeconds } = activityLimits()
  return {
    accepted,
    ...(reason ? { reason } : {}),
    ...(sessionId ? { sessionId } : {}),
    serverTime: now.toISOString(),
    ...(accepted
      ? { onlineUntil: new Date(now.getTime() + offlineSeconds * 1000).toISOString() }
      : {}),
  }
}

export async function resolveBrowserActivityContext(
  req: Request,
  now = new Date(),
): Promise<BrowserActivityContext | ActivityIngestRejection> {
  if (req.user?.impersonatedBy) return 'IMPERSONATION'

  const refreshToken = req.cookies?.refresh_token
  if (typeof refreshToken !== 'string' || !refreshToken) return 'NO_BROWSER_SESSION'
  if (!req.user?.userId) return 'NO_BROWSER_SESSION'

  const authSession = await prisma.userSession.findUnique({
    where: { refreshToken },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      expiresAt: true,
      user: { select: { isActive: true } },
    },
  })

  if (!authSession || authSession.userId !== req.user.userId) return 'NO_BROWSER_SESSION'
  if (authSession.expiresAt <= now) return 'SESSION_EXPIRED'
  if (!authSession.user.isActive) return 'USER_INACTIVE'

  return {
    userId: authSession.userId,
    authSessionId: authSession.id,
    authSessionCreatedAt: authSession.createdAt,
    authSessionExpiresAt: authSession.expiresAt,
  }
}

async function observePage(
  tx: Prisma.TransactionClient,
  sessionId: string,
  pageKey: ActivityPageKey,
  observedAt: Date,
): Promise<void> {
  await tx.activityPageAggregate.upsert({
    where: {
      sessionId_pageKey_day: { sessionId, pageKey, day: utcDay(observedAt) },
    },
    create: {
      sessionId,
      pageKey,
      day: utcDay(observedAt),
      activeSeconds: 0,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
    },
    update: { lastSeenAt: observedAt },
  })
}

async function applyCredit(
  tx: Prisma.TransactionClient,
  sessionId: string,
  pageKey: string,
  credit: ActivityCredit,
): Promise<void> {
  for (const slice of splitActivityInterval(credit.from, credit.to)) {
    await tx.activityPageAggregate.upsert({
      where: {
        sessionId_pageKey_day: { sessionId, pageKey, day: slice.day },
      },
      create: {
        sessionId,
        pageKey,
        day: slice.day,
        activeSeconds: slice.seconds,
        firstSeenAt: credit.from,
        lastSeenAt: credit.to,
      },
      update: {
        activeSeconds: { increment: slice.seconds },
        lastSeenAt: credit.to,
      },
    })
  }
}

function assertHeartbeatInput(input: ActivityHeartbeatInput): void {
  if (!Number.isInteger(input.seq) || input.seq < 0 || input.seq > 2_147_483_647) {
    throw new AppError('VALIDATION_ERROR', 'Séquence de télémétrie invalide', 400)
  }
  if (!isActivityPageKey(input.pageKey)) {
    throw new AppError('VALIDATION_ERROR', "Page d'activité inconnue", 400)
  }
}

function assertEndInput(input: ActivityEndInput): void {
  if (!Number.isInteger(input.seq) || input.seq < 0 || input.seq > 2_147_483_647) {
    throw new AppError('VALIDATION_ERROR', 'Séquence de télémétrie invalide', 400)
  }
}

export async function recordActivityHeartbeat(
  context: BrowserActivityContext,
  input: ActivityHeartbeatInput,
  now = new Date(),
): Promise<ActivityIngestResult> {
  assertHeartbeatInput(input)

  let activitySession
  try {
    activitySession = await prisma.activitySession.upsert({
      where: { authSessionId: context.authSessionId },
      create: {
      authSessionId: context.authSessionId,
      userId: context.userId,
      authExpiresAt: context.authSessionExpiresAt,
      startedAt: context.authSessionCreatedAt,
      lastSeenAt: now,
      lastAccountedAt: now,
    },
      update: {}, select: { id: true },
    })
  } catch (error) {
    // Deux onglets peuvent créer simultanément la même session unique.
    if ((error as { code?: string }).code !== 'P2002') throw error
    activitySession = await prisma.activitySession.findUniqueOrThrow({ where: { authSessionId: context.authSessionId }, select: { id: true } })
  }

  return prisma.$transaction(async tx => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "activity_sessions"
      WHERE "id" = ${activitySession.id}
      FOR UPDATE
    `

    const currentSession = await tx.activitySession.findUnique({
      where: { id: activitySession.id },
    })
    if (!currentSession || currentSession.endedAt) {
      return ingestResult(now, false, currentSession?.id, 'SESSION_EXPIRED')
    }

    const previousTab = await tx.activityTab.findUnique({
      where: {
        sessionId_tabId: { sessionId: currentSession.id, tabId: input.tabId },
      },
    })

    if (previousTab && input.seq <= previousTab.seq) {
      return ingestResult(now, false, currentSession.id, 'DUPLICATE')
    }

    if (!previousTab) {
      const tabCount = await tx.activityTab.count({ where: { sessionId: currentSession.id } })
      if (tabCount >= MAX_TABS_PER_SESSION) {
        throw new AppError(
          'VALIDATION_ERROR',
          "Nombre maximal d'onglets atteint pour cette session",
          400,
        )
      }
    }

    const eventNow = previousTab
      ? maxDate(now, currentSession.lastSeenAt, previousTab.lastSeenAt)
      : maxDate(now, currentSession.lastSeenAt)
    const { maxCreditSeconds } = activityLimits()
    const credit = previousTab
      ? calculateActivityCredit({
          previousTabIsActive: previousTab.isActive,
          previousTabLastSeenAt: previousTab.lastSeenAt,
          sessionLastAccountedAt: currentSession.lastAccountedAt,
          now: eventNow,
          maxCreditSeconds,
        })
      : null

    if (credit && previousTab) {
      await applyCredit(tx, currentSession.id, previousTab.pageKey, credit)
    }
    await observePage(tx, currentSession.id, input.pageKey, eventNow)

    await tx.activityTab.upsert({
      where: {
        sessionId_tabId: { sessionId: currentSession.id, tabId: input.tabId },
      },
      create: {
        sessionId: currentSession.id,
        tabId: input.tabId,
        seq: input.seq,
        pageKey: input.pageKey,
        isActive: input.isActive,
        lastSeenAt: eventNow,
      },
      update: {
        seq: input.seq,
        pageKey: input.pageKey,
        isActive: input.isActive,
        lastSeenAt: eventNow,
        endedAt: null,
      },
    })

    await tx.activitySession.update({
      where: { id: currentSession.id },
      data: {
        lastSeenAt: eventNow,
        ...(input.isActive || credit ? { lastActiveAt: eventNow } : {}),
        ...(credit
          ? {
              lastAccountedAt: eventNow,
              activeSeconds: { increment: credit.seconds },
            }
          : {}),
      },
    })

    return ingestResult(eventNow, true, currentSession.id)
  })
}

export async function endActivityTab(
  context: BrowserActivityContext,
  input: ActivityEndInput,
  now = new Date(),
): Promise<ActivityIngestResult> {
  assertEndInput(input)

  const activitySession = await prisma.activitySession.findUnique({
    where: { authSessionId: context.authSessionId },
    select: { id: true },
  })
  if (!activitySession) return ingestResult(now, false, undefined, 'DUPLICATE')

  return prisma.$transaction(async tx => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "activity_sessions"
      WHERE "id" = ${activitySession.id}
      FOR UPDATE
    `

    const currentSession = await tx.activitySession.findUnique({
      where: { id: activitySession.id },
    })
    if (!currentSession || currentSession.endedAt) {
      return ingestResult(now, false, currentSession?.id, 'DUPLICATE')
    }

    const previousTab = await tx.activityTab.findUnique({
      where: {
        sessionId_tabId: { sessionId: currentSession.id, tabId: input.tabId },
      },
    })
    if (!previousTab || input.seq <= previousTab.seq) {
      return ingestResult(now, false, currentSession.id, 'DUPLICATE')
    }

    const eventNow = maxDate(now, currentSession.lastSeenAt, previousTab.lastSeenAt)
    const { maxCreditSeconds } = activityLimits()
    const credit = calculateActivityCredit({
      previousTabIsActive: previousTab.isActive,
      previousTabLastSeenAt: previousTab.lastSeenAt,
      sessionLastAccountedAt: currentSession.lastAccountedAt,
      now: eventNow,
      maxCreditSeconds,
    })

    if (credit) await applyCredit(tx, currentSession.id, previousTab.pageKey, credit)

    await tx.activityTab.update({
      where: { id: previousTab.id },
      data: {
        seq: input.seq,
        isActive: false,
        lastSeenAt: eventNow,
        endedAt: eventNow,
      },
    })
    await tx.activitySession.update({
      where: { id: currentSession.id },
      data: {
        lastSeenAt: eventNow,
        ...(credit
          ? {
              lastActiveAt: eventNow,
              lastAccountedAt: eventNow,
              activeSeconds: { increment: credit.seconds },
            }
          : {}),
      },
    })

    return ingestResult(eventNow, true, currentSession.id)
  })
}

export async function closeActivitySessionForLogout(
  authSessionId: string,
  now = new Date(),
): Promise<void> {
  try {
    const existing = await prisma.activitySession.findUnique({
      where: { authSessionId },
      select: { id: true },
    })
    if (!existing) return

    await prisma.$transaction(async tx => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "activity_sessions"
        WHERE "id" = ${existing.id}
        FOR UPDATE
      `
      const session = await tx.activitySession.findUnique({ where: { id: existing.id } })
      if (!session || session.endedAt) return

      const latestActiveTab = await tx.activityTab.findFirst({
        where: { sessionId: session.id, isActive: true, endedAt: null },
        orderBy: { lastSeenAt: 'desc' },
      })
      const eventNow = latestActiveTab
        ? maxDate(now, session.lastSeenAt, latestActiveTab.lastSeenAt)
        : maxDate(now, session.lastSeenAt)
      const { maxCreditSeconds } = activityLimits()
      const credit = latestActiveTab
        ? calculateActivityCredit({
            previousTabIsActive: true,
            previousTabLastSeenAt: latestActiveTab.lastSeenAt,
            sessionLastAccountedAt: session.lastAccountedAt,
            now: eventNow,
            maxCreditSeconds,
          })
        : null

      if (credit && latestActiveTab) {
        await applyCredit(tx, session.id, latestActiveTab.pageKey, credit)
      }
      await tx.activityTab.updateMany({
        where: { sessionId: session.id, endedAt: null },
        data: { isActive: false, endedAt: eventNow, lastSeenAt: eventNow },
      })
      await tx.activitySession.update({
        where: { id: session.id },
        data: {
          endedAt: eventNow,
          lastSeenAt: eventNow,
          ...(credit
            ? {
                lastActiveAt: eventNow,
                lastAccountedAt: eventNow,
                activeSeconds: { increment: credit.seconds },
              }
            : {}),
        },
      })
    })
  } catch {
    // L'observabilité ne doit jamais empêcher la déconnexion principale.
    console.error("[Activity] Clôture de la session d'activité impossible")
  }
}

export async function pruneExpiredActivity(now = new Date()): Promise<number> {
  const retentionDays = clamp(
    Math.trunc(getConfigNumber('ACTIVITY_RETENTION_DAYS', 90)),
    1,
    90,
  )
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)

  const [, deletedSessions] = await prisma.$transaction([
    prisma.activityPageAggregate.deleteMany({ where: { day: { lt: utcDay(cutoff) } } }),
    prisma.activitySession.deleteMany({
      where: {
        authExpiresAt: { lt: cutoff },
        lastSeenAt: { lt: cutoff },
        OR: [{ endedAt: null }, { endedAt: { lt: cutoff } }],
      },
    }),
  ])

  return deletedSessions.count
}

export function startActivityRetentionJob(): void {
  if (process.env.NODE_ENV === 'test' || retentionTimer) return

  void pruneExpiredActivity().catch(() => {
    console.error("[Activity] Purge des données d'activité impossible")
  })
  retentionTimer = setInterval(() => {
    void pruneExpiredActivity().catch(() => {
      console.error("[Activity] Purge des données d'activité impossible")
    })
  }, RETENTION_INTERVAL_MS)
  retentionTimer.unref()
}
