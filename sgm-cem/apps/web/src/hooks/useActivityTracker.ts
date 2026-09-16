'use client'

import { useEffect, useRef } from 'react'
import {
  isActivityPageKey,
  type ActivityEndInput,
  type ActivityHeartbeatInput,
  type ActivityPageKey,
} from '@sgm-cem/shared'
import api from '@/lib/api'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'

const HEARTBEAT_INTERVAL_MS = 30_000
const IDLE_DELAY_MS = 120_000
const PAGE_CHANGE_DEBOUNCE_MS = 250

interface TrackableUser {
  id: string
  role: string
  impersonatedBy?: string | null
}

export function shouldTrackActivity(
  isAuthenticated: boolean,
  user: TrackableUser | null | undefined,
): user is TrackableUser {
  return Boolean(isAuthenticated && user && !user.impersonatedBy)
}

export function isActivityActive(input: {
  isVisible: boolean
  hasFocus: boolean
  lastInteractionAt: number
  now: number
}): boolean {
  return input.isVisible
    && input.hasFocus
    && input.now - input.lastInteractionAt < IDLE_DELAY_MS
}

function resolveTrackedPage(activeView: string, role: string): ActivityPageKey | null {
  if (role === 'MEMBRE') {
    if (activeView === 'dashboard' || activeView === 'mes-contributions') return 'mes-contributions'
    if (['rubriques', 'notifications', 'journal', 'mon-profil'].includes(activeView)) {
      return activeView as ActivityPageKey
    }
    return 'mes-contributions'
  }

  if (role === 'COLLECTEUR') {
    if (['dashboard', 'contributions', 'collecteurs', 'validations', 'notifications', 'journal', 'mon-profil'].includes(activeView)) {
      return activeView as ActivityPageKey
    }
    return 'dashboard'
  }

  return isActivityPageKey(activeView) ? activeView : null
}

function createTabId(cryptoRef: Crypto): string {
  if (typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID()

  const bytes = new Uint8Array(16)
  cryptoRef.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}

export interface ActivityTrackerController {
  notifyPageChange: () => void
  stop: () => void
}

interface ActivityTrackerOptions {
  tabId: string
  windowRef: Window
  documentRef: Document
  getPageKey: () => ActivityPageKey | null
  isCurrentIdentity: () => boolean
  postHeartbeat: (payload: ActivityHeartbeatInput) => Promise<unknown>
  postEnd: (payload: ActivityEndInput) => Promise<unknown>
  now?: () => number
}

export function createActivityTracker(options: ActivityTrackerOptions): ActivityTrackerController {
  const {
    tabId,
    windowRef,
    documentRef,
    getPageKey,
    isCurrentIdentity,
    postHeartbeat,
    postEnd,
    now = Date.now,
  } = options

  let seq = 0
  let ended = false
  let stopped = false
  let lastInteractionAt = now()
  let lastActive: boolean | null = null
  let idleTimer: number | null = null
  let pageTimer: number | null = null

  const currentActive = () => isActivityActive({
    isVisible: documentRef.visibilityState === 'visible',
    hasFocus: documentRef.hasFocus(),
    lastInteractionAt,
    now: now(),
  })

  const heartbeat = (force = false) => {
    if (stopped || ended || !isCurrentIdentity()) return
    const pageKey = getPageKey()
    if (!pageKey || !isActivityPageKey(pageKey)) return

    const isActive = currentActive()
    if (!force && isActive === lastActive) return
    lastActive = isActive
    const payload: ActivityHeartbeatInput = { tabId, seq: ++seq, pageKey, isActive }
    void postHeartbeat(payload).catch(() => undefined)
  }

  const scheduleIdleTransition = () => {
    if (idleTimer !== null) windowRef.clearTimeout(idleTimer)
    const remaining = Math.max(0, IDLE_DELAY_MS - (now() - lastInteractionAt))
    idleTimer = windowRef.setTimeout(() => heartbeat(false), remaining)
  }

  const recordInteraction = () => {
    if (stopped || ended) return
    const wasActive = currentActive()
    lastInteractionAt = now()
    scheduleIdleTransition()
    if (!wasActive && currentActive()) heartbeat(false)
  }

  const handlePresenceChange = () => {
    heartbeat(false)
    scheduleIdleTransition()
  }

  const end = () => {
    if (stopped || ended || !isCurrentIdentity()) return
    ended = true
    const payload: ActivityEndInput = { tabId, seq: ++seq }
    void postEnd(payload).catch(() => undefined)
  }

  const handlePageHide = () => end()
  const handlePageShow = (event: PageTransitionEvent) => {
    if (!event.persisted || stopped || !isCurrentIdentity()) return
    ended = false
    lastInteractionAt = now()
    lastActive = null
    heartbeat(true)
    scheduleIdleTransition()
  }
  const handleOnline = () => heartbeat(true)

  const interactionEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'scroll', 'touchstart']
  for (const eventName of interactionEvents) {
    windowRef.addEventListener(eventName, recordInteraction, { passive: true })
  }
  windowRef.addEventListener('focus', handlePresenceChange)
  windowRef.addEventListener('blur', handlePresenceChange)
  windowRef.addEventListener('online', handleOnline)
  windowRef.addEventListener('pagehide', handlePageHide)
  windowRef.addEventListener('pageshow', handlePageShow)
  documentRef.addEventListener('visibilitychange', handlePresenceChange)

  const heartbeatInterval = windowRef.setInterval(() => heartbeat(true), HEARTBEAT_INTERVAL_MS)
  heartbeat(true)
  scheduleIdleTransition()

  return {
    notifyPageChange: () => {
      if (stopped || ended) return
      if (pageTimer !== null) windowRef.clearTimeout(pageTimer)
      pageTimer = windowRef.setTimeout(() => heartbeat(true), PAGE_CHANGE_DEBOUNCE_MS)
    },
    stop: () => {
      if (stopped) return
      end()
      stopped = true
      windowRef.clearInterval(heartbeatInterval)
      if (idleTimer !== null) windowRef.clearTimeout(idleTimer)
      if (pageTimer !== null) windowRef.clearTimeout(pageTimer)
      for (const eventName of interactionEvents) {
        windowRef.removeEventListener(eventName, recordInteraction)
      }
      windowRef.removeEventListener('focus', handlePresenceChange)
      windowRef.removeEventListener('blur', handlePresenceChange)
      windowRef.removeEventListener('online', handleOnline)
      windowRef.removeEventListener('pagehide', handlePageHide)
      windowRef.removeEventListener('pageshow', handlePageShow)
      documentRef.removeEventListener('visibilitychange', handlePresenceChange)
    },
  }
}

export function useActivityTracker(): void {
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const user = useAuthStore(state => state.user)
  const activeView = useAppStore(state => state.activeView)
  const controllerRef = useRef<ActivityTrackerController | null>(null)
  const pageRef = useRef<ActivityPageKey | null>(resolveTrackedPage(activeView, user?.role ?? ''))

  useEffect(() => {
    const nextPage = resolveTrackedPage(activeView, user?.role ?? '')
    if (nextPage === pageRef.current) return
    pageRef.current = nextPage
    controllerRef.current?.notifyPageChange()
  }, [activeView, user?.role])

  useEffect(() => {
    if (!shouldTrackActivity(isAuthenticated, user)) return

    const trackedUserId = user.id
    const controller = createActivityTracker({
      tabId: createTabId(window.crypto),
      windowRef: window,
      documentRef: document,
      getPageKey: () => pageRef.current,
      isCurrentIdentity: () => {
        const current = useAuthStore.getState()
        return Boolean(
          current.isAuthenticated
          && current.user?.id === trackedUserId
          && !current.user.impersonatedBy,
        )
      },
      postHeartbeat: payload => api.post('/activity/heartbeat', payload),
      postEnd: payload => api.post('/activity/end', payload),
    })
    controllerRef.current = controller

    return () => {
      controller.stop()
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [isAuthenticated, user?.id, user?.impersonatedBy])
}
