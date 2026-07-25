import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bell,
  Briefcase,
  CreditCard,
  FileText,
  FolderOpen,
  Globe,
  History,
  LayoutDashboard,
  Settings,
  Shield,
  Terminal,
  UserCheck,
  UserCircle,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { ROLE_LEVELS } from '@/lib/utils'
import type { UserRole } from '@/types'

export type ViewId =
  | 'dashboard'
  | 'rubriques'
  | 'contributions'
  | 'collecteurs'
  | 'validations'
  | 'transfer-validations'
  | 'collectes-publiques'
  | 'membres'
  | 'mes-contributions'
  | 'ged'
  | 'prestations'
  | 'litiges'
  | 'statistiques'
  | 'rapports'
  | 'notifications'
  | 'journal'
  | 'utilisateurs'
  | 'parametres'
  | 'developer'
  | 'mon-profil'

export type NavigationSection =
  | 'NAVIGATION'
  | 'FINANCES'
  | 'MEMBRES'
  | 'MON_ESPACE'
  | 'GESTION'
  | 'OUTILS'
  | 'SYSTEME'
  | 'MON_COMPTE'

export interface NavigationItem {
  id: ViewId
  label: string
  title: string
  shortLabel: string
  icon: LucideIcon
  section: NavigationSection
  minLevel?: number
  roles?: readonly UserRole[]
  excludeRoles?: readonly UserRole[]
  mobile?: {
    order: number
    roles: readonly UserRole[]
  }
}

const ROLES_NIVEAU_3: readonly UserRole[] = [
  'ADJOINT_RESPONSABLE',
  'RESPONSABLE',
  'TRESORIER',
  'ADMIN',
  'DEVELOPER',
]

const ROLES_HORS_MEMBRE: readonly UserRole[] = [
  'COLLECTEUR',
  ...ROLES_NIVEAU_3,
]

const TOUS_LES_ROLES: readonly UserRole[] = [
  'MEMBRE',
  ...ROLES_HORS_MEMBRE,
]

export const NAVIGATION_SECTIONS: readonly NavigationSection[] = [
  'NAVIGATION',
  'FINANCES',
  'MEMBRES',
  'MON_ESPACE',
  'GESTION',
  'OUTILS',
  'SYSTEME',
  'MON_COMPTE',
]

export const NAVIGATION_SECTION_LABELS: Record<NavigationSection, string> = {
  NAVIGATION: '',
  FINANCES: 'Finances',
  MEMBRES: 'Membres',
  MON_ESPACE: 'Mon espace',
  GESTION: 'Gestion',
  OUTILS: 'Outils',
  SYSTEME: 'Système',
  MON_COMPTE: 'Mon compte',
}

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  {
    id: 'dashboard',
    label: 'Tableau de bord',
    title: 'Tableau de bord',
    shortLabel: 'Accueil',
    icon: LayoutDashboard,
    section: 'NAVIGATION',
    minLevel: 2,
    excludeRoles: ['MEMBRE'],
    mobile: { order: 1, roles: ROLES_HORS_MEMBRE },
  },
  {
    id: 'rubriques',
    label: 'Rubriques',
    title: 'Rubriques',
    shortLabel: 'Rubriques',
    icon: FolderOpen,
    section: 'FINANCES',
    minLevel: 1,
    excludeRoles: ['MEMBRE'],
    mobile: { order: 2, roles: ROLES_HORS_MEMBRE },
  },
  {
    id: 'contributions',
    label: 'Contributions',
    title: 'Contributions',
    shortLabel: 'Paiements',
    icon: CreditCard,
    section: 'FINANCES',
    minLevel: 2,
    excludeRoles: ['MEMBRE'],
    mobile: { order: 3, roles: ROLES_HORS_MEMBRE },
  },
  {
    id: 'collecteurs',
    label: 'Fonds collecteurs',
    title: 'Fonds collecteurs',
    shortLabel: 'Fonds',
    icon: Wallet,
    section: 'FINANCES',
    minLevel: 2,
    mobile: { order: 5, roles: ['COLLECTEUR'] },
  },
  {
    id: 'validations',
    label: 'Validations',
    title: 'Validations en attente',
    shortLabel: 'Validations',
    icon: UserCheck,
    section: 'FINANCES',
    minLevel: 2,
    excludeRoles: ['MEMBRE'],
  },
  {
    id: 'transfer-validations',
    label: 'Fonds à réceptionner',
    title: 'Fonds à réceptionner',
    shortLabel: 'Réceptions',
    icon: Shield,
    section: 'FINANCES',
    minLevel: 2,
    excludeRoles: ['MEMBRE'],
    mobile: { order: 4, roles: ROLES_HORS_MEMBRE },
  },
  {
    id: 'collectes-publiques',
    label: 'Collectes publiques',
    title: 'Collectes publiques',
    shortLabel: 'Collectes',
    icon: Globe,
    section: 'FINANCES',
    roles: ['TRESORIER', 'ADMIN', 'DEVELOPER'],
  },
  {
    id: 'membres',
    label: 'Membres',
    title: 'Gestion des membres',
    shortLabel: 'Membres',
    icon: Users,
    section: 'MEMBRES',
    minLevel: 3,
    mobile: { order: 5, roles: ROLES_NIVEAU_3 },
  },
  {
    id: 'mes-contributions',
    label: 'Mes contributions',
    title: 'Mes contributions',
    shortLabel: 'Mes dons',
    icon: CreditCard,
    section: 'MON_ESPACE',
    roles: ['MEMBRE'],
    mobile: { order: 1, roles: ['MEMBRE'] },
  },
  {
    id: 'ged',
    label: 'GED Commissions',
    title: 'GED Commissions',
    shortLabel: 'GED',
    icon: Archive,
    section: 'GESTION',
    minLevel: 3,
  },
  {
    id: 'prestations',
    label: 'Prestations',
    title: 'Prestations de génie',
    shortLabel: 'Prestations',
    icon: Briefcase,
    section: 'GESTION',
    minLevel: 3,
  },
  {
    id: 'litiges',
    label: 'Litiges',
    title: 'Gestion des litiges',
    shortLabel: 'Litiges',
    icon: AlertTriangle,
    section: 'GESTION',
    minLevel: 3,
  },
  {
    id: 'statistiques',
    label: 'Statistiques',
    title: 'Statistiques et analyses',
    shortLabel: 'Stats',
    icon: BarChart3,
    section: 'OUTILS',
    minLevel: 3,
  },
  {
    id: 'rapports',
    label: 'Rapports',
    title: 'Rapports',
    shortLabel: 'Rapports',
    icon: FileText,
    section: 'OUTILS',
    minLevel: 3,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    title: 'Notifications',
    shortLabel: 'Notifs',
    icon: Bell,
    section: 'OUTILS',
    minLevel: 1,
    mobile: { order: 6, roles: TOUS_LES_ROLES },
  },
  {
    id: 'journal',
    label: "Journal d'activité",
    title: "Journal d'activité",
    shortLabel: 'Journal',
    icon: History,
    section: 'OUTILS',
    minLevel: 1,
  },
  {
    id: 'utilisateurs',
    label: 'Utilisateurs',
    title: 'Utilisateurs',
    shortLabel: 'Utilisateurs',
    icon: UserCog,
    section: 'SYSTEME',
    roles: ['ADMIN', 'DEVELOPER'],
  },
  {
    id: 'parametres',
    label: 'Paramètres',
    title: 'Paramètres système',
    shortLabel: 'Paramètres',
    icon: Settings,
    section: 'SYSTEME',
    roles: ['ADMIN', 'DEVELOPER'],
  },
  {
    id: 'developer',
    label: 'Développeur',
    title: 'Espace développeur',
    shortLabel: 'Développeur',
    icon: Terminal,
    section: 'SYSTEME',
    roles: ['DEVELOPER'],
  },
  {
    id: 'mon-profil',
    label: 'Mon profil',
    title: 'Mon profil',
    shortLabel: 'Profil',
    icon: UserCircle,
    section: 'MON_COMPTE',
    minLevel: 1,
    mobile: { order: 5, roles: ['MEMBRE', 'COLLECTEUR'] },
  },
]

function canAccessItem(role: UserRole, item: NavigationItem): boolean {
  if (item.roles) return item.roles.includes(role)
  if (item.excludeRoles?.includes(role)) return false
  return ROLE_LEVELS[role] >= (item.minLevel ?? 1)
}

export function getNavigationForRole(role: UserRole): NavigationItem[] {
  return NAVIGATION_ITEMS.filter(item => canAccessItem(role, item))
}

export function canAccessView(role: UserRole, view: ViewId): boolean {
  const item = NAVIGATION_ITEMS.find(candidate => candidate.id === view)
  return item ? canAccessItem(role, item) : false
}

export function getViewTitle(view: ViewId): string {
  const item = NAVIGATION_ITEMS.find(candidate => candidate.id === view)
  return item?.title ?? 'SGM-CEM'
}

export function getMobileNavigationForRole(role: UserRole): NavigationItem[] {
  return getNavigationForRole(role)
    .filter(item => item.mobile?.roles.includes(role))
    .sort((left, right) => (left.mobile?.order ?? 0) - (right.mobile?.order ?? 0))
    .slice(0, 5)
}
