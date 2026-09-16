// -----------------------------------------------------------------------------
// OBSERVABILITE — contrat partage entre l'API et l'application web
// -----------------------------------------------------------------------------

export const ACTIVITY_PAGE_KEYS = [
  'dashboard',
  'rubriques',
  'contributions',
  'collecteurs',
  'validations',
  'transfer-validations',
  'collectes-publiques',
  'membres',
  'mes-contributions',
  'ged',
  'prestations',
  'litiges',
  'statistiques',
  'rapports',
  'notifications',
  'journal',
  'utilisateurs',
  'parametres',
  'developer',
  'mon-profil',
  'observabilite',
] as const

export type ActivityPageKey = (typeof ACTIVITY_PAGE_KEYS)[number]

export function isActivityPageKey(value: unknown): value is ActivityPageKey {
  return typeof value === 'string' && (ACTIVITY_PAGE_KEYS as readonly string[]).includes(value)
}

export const ACTIVITY_PAGE_LABELS: Record<ActivityPageKey, string> = {
  dashboard: 'Tableau de bord',
  rubriques: 'Rubriques',
  contributions: 'Contributions',
  collecteurs: 'Fonds collecteurs',
  validations: 'Validations',
  'transfer-validations': 'Fonds à réceptionner',
  'collectes-publiques': 'Collectes publiques',
  membres: 'Membres',
  'mes-contributions': 'Mes contributions',
  ged: 'GED Commissions',
  prestations: 'Prestations',
  litiges: 'Litiges',
  statistiques: 'Statistiques',
  rapports: 'Rapports',
  notifications: 'Notifications',
  journal: "Journal d'activité",
  utilisateurs: 'Utilisateurs',
  parametres: 'Paramètres',
  developer: 'Espace développeur',
  'mon-profil': 'Mon profil',
  observabilite: 'Observabilité',
}

export const ACTIVITY_ACTION_KINDS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGOUT',
  'CONFIRM',
  'CONFIRM_OVERRIDE',
  'REJECT',
  'APPROVE',
  'TRANSFER',
  'CLAIM',
  'TRANSFER_CONFIRMED',
  'TRANSFER_REFUSED',
  'TRANSFER_CANCELLED',
  'IMPERSONATE',
] as const

export type ActivityActionKind = (typeof ACTIVITY_ACTION_KINDS)[number]

export interface ActivityHeartbeatInput {
  tabId: string
  seq: number
  pageKey: ActivityPageKey
  isActive: boolean
}

export interface ActivityEndInput {
  tabId: string
  seq: number
}

export type ActivityIngestRejection =
  | 'IMPERSONATION'
  | 'NO_BROWSER_SESSION'
  | 'SESSION_EXPIRED'
  | 'USER_INACTIVE'
  | 'DUPLICATE'

export interface ActivityIngestResult {
  accepted: boolean
  reason?: ActivityIngestRejection
  sessionId?: string
  serverTime: string
  onlineUntil?: string
}

export type ActivityRangeDays = 7 | 30 | 90

export type ActivityPresence = 'ONLINE' | 'OFFLINE'

export type ActivitySessionState = 'ONLINE' | 'INACTIVE' | 'EXPIRED' | 'LOGGED_OUT'

export interface ActivityOverview {
  range: {
    days: ActivityRangeDays
    from: string
    to: string
  }
  presence: {
    onlineUsers: number
    offlineUsers: number
    activeAccounts: number
  }
  sessions: {
    started: number
    explicitLogouts: number
    expired: number
    activeSeconds: number
    averageActiveSeconds: number
  }
  actions: {
    total: number
    failedLogins: number
  }
  topPages: Array<{
    pageKey: ActivityPageKey
    activeSeconds: number
    uniqueUsers: number
  }>
  daily: Array<{
    day: string
    uniqueUsers: number
    activeSeconds: number
    actions: number
  }>
}

export interface ActivityUserRow {
  userId: string
  fullName: string
  role: string
  isActive: boolean
  presence: ActivityPresence
  lastSeenAt: string | null
  openSessions: number
  sessions: number
  activeSeconds: number
  actions: number
  failedLogins: number
}

export interface ActivitySessionTab {
  tabId: string
  pageKey: ActivityPageKey
  isActive: boolean
  lastSeenAt: string
  endedAt: string | null
}

export interface ActivitySessionPage {
  day: string
  pageKey: ActivityPageKey
  activeSeconds: number
}

export interface ActivitySessionRow {
  id: string
  userId: string
  userName: string
  role: string
  startedAt: string
  lastSeenAt: string
  lastActiveAt: string | null
  endedAt: string | null
  authExpiresAt: string
  state: ActivitySessionState
  activeSeconds: number
  tabs: ActivitySessionTab[]
  pages: ActivitySessionPage[]
}

export interface ActivityActionRow {
  id: string
  userId: string | null
  userName: string
  role: string
  action: ActivityActionKind
  entityType: string
  occurredAt: string
  success: boolean | null
}

export interface ActivityPaginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
