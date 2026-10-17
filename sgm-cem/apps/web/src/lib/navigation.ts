// Table UNIQUE de navigation (UX-02/UX-05) : le menu latéral, la barre
// d'onglets et le contrôle d'accès des écrans en dérivent tous. L'API reste
// l'autorité sur les droits ; cette table ne fait que ne pas proposer
// ce qui serait refusé.
import {
  LayoutDashboard, FolderOpen, CreditCard, Wallet, UserCheck, Shield,
  Users, Archive, Briefcase, AlertTriangle, BarChart3, FileText,
  Bell, Settings, UserCog, CreditCard as CardIcon, UserCircle, Terminal, History, Globe, Activity,
  HandCoins, Inbox,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ROLE_LEVELS } from '@/lib/utils'

export interface NavItem {
  id: string
  label: string
  icon: LucideIcon
  section: string
  minLevel?: number
  roles?: string[]
  excludeRoles?: string[]
}

// ─── Navigation par rôle ─────────────────────────────────────────────
// minLevel : niveau minimum pour voir l'item
// roles : liste de rôles exclusifs (si défini, remplace minLevel)
export const NAV_ITEMS: NavItem[] = [
  // ── Accueil ─────────────────────────────────────────────────────────
  { id: 'dashboard',       label: 'Tableau de Bord',    icon: LayoutDashboard, section: 'NAVIGATION',   minLevel: 1 },
  // ── Finances ────────────────────────────────────────────────────────
  { id: 'rubriques',       label: 'Rubriques',           icon: FolderOpen,      section: 'FINANCES',     minLevel: 1 },
  { id: 'contributions',   label: 'Contributions',       icon: CreditCard,      section: 'FINANCES',     minLevel: 2, excludeRoles: ['MEMBRE'] },
  { id: 'collecteurs',     label: 'Fonds Collecteurs',   icon: Wallet,          section: 'FINANCES',     minLevel: 2 },
  { id: 'validations',     label: 'Validations',         icon: UserCheck,      section: 'FINANCES',     minLevel: 2, excludeRoles: ['MEMBRE'] },
  { id: 'transfer-validations', label: 'Fonds à réceptionner', icon: Shield,          section: 'FINANCES',     minLevel: 2, excludeRoles: ['MEMBRE'] },
  // Collectes ouvertes au public via lien — création/gestion Admin + Trésorier (+ Développeur)
  { id: 'collectes-publiques', label: 'Collectes publiques', icon: Globe,           section: 'FINANCES',     roles: ['ADMIN', 'TRESORIER', 'DEVELOPER'] },
  // ── Membres ─────────────────────────────────────────────────────────
  { id: 'membres',         label: 'Membres',             icon: Users,           section: 'MEMBRES',      minLevel: 2, excludeRoles: ['COLLECTEUR', 'MEMBRE'] },
  // ── Membre : vue perso ───────────────────────────────────────────────
  { id: 'mes-contributions', label: 'Mes Contributions', icon: CardIcon,        section: 'MON_ESPACE',   roles: ['MEMBRE'] },
  // ── Gestion ─────────────────────────────────────────────────────────
  { id: 'ged',             label: 'GED Commissions',     icon: Archive,         section: 'GESTION',      minLevel: 2, excludeRoles: ['COLLECTEUR', 'MEMBRE'] },
  { id: 'prestations',     label: 'Prestations',         icon: Briefcase,       section: 'GESTION',      minLevel: 2, excludeRoles: ['COLLECTEUR', 'MEMBRE'] },
  { id: 'litiges',         label: 'Litiges',             icon: AlertTriangle,   section: 'GESTION',      minLevel: 3 },
  // ── Outils ──────────────────────────────────────────────────────────
  { id: 'statistiques',    label: 'Statistiques',        icon: BarChart3,       section: 'OUTILS',       minLevel: 3 },
  { id: 'rapports',        label: 'Rapports',            icon: FileText,        section: 'OUTILS',       minLevel: 3 },
  { id: 'notifications',   label: 'Notifications',       icon: Bell,            section: 'OUTILS',       minLevel: 1 },
  // Journal d'audit : chacun voit au moins sa propre activité (périmètre élargi par rôle côté API)
  { id: 'journal',         label: "Journal d'activité",  icon: History,         section: 'OUTILS',       minLevel: 1 },
  { id: 'observabilite',   label: 'Observabilité',       icon: Activity,       section: 'OUTILS',       roles: ['ADMIN', 'DEVELOPER'] },
  // ── Système ─────────────────────────────────────────────────────────
  { id: 'utilisateurs',    label: 'Utilisateurs',        icon: UserCog,         section: 'SYSTEME',      roles: ['ADMIN', 'DEVELOPER'] },
  { id: 'parametres',      label: 'Paramètres',          icon: Settings,        section: 'SYSTEME',      roles: ['ADMIN', 'DEVELOPER'] },
  // Panneau développeur — rôle DEVELOPER exclusivement (jamais ADMIN)
  { id: 'developer',       label: 'Développeur',         icon: Terminal,        section: 'SYSTEME',      roles: ['DEVELOPER'] },
  // ── Mon compte ──────────────────────────────────────────────────────
  { id: 'mon-profil',      label: 'Mon Profil',          icon: UserCircle,      section: 'MON_COMPTE',   minLevel: 1 },
]

export const SECTIONS = ['NAVIGATION', 'FINANCES', 'MEMBRES', 'MON_ESPACE', 'GESTION', 'OUTILS', 'SYSTEME', 'MON_COMPTE']
export const SECTION_LABELS: Record<string, string> = {
  NAVIGATION: '', FINANCES: 'Finances', MEMBRES: 'Membres',
  MON_ESPACE: 'Mon espace', GESTION: 'Gestion', OUTILS: 'Outils',
  SYSTEME: 'Système', MON_COMPTE: 'Mon compte',
}

/** L'utilisateur de ce rôle peut-il ouvrir cet écran ? */
export function canAccessView(view: string, role: string | undefined): boolean {
  if (view === 'dashboard') return true
  const item = NAV_ITEMS.find(entry => entry.id === view)
  if (!item || !role) return false
  if (item.roles) return item.roles.includes(role)
  if (item.excludeRoles?.includes(role)) return false
  return (ROLE_LEVELS[role] ?? 1) >= (item.minLevel ?? 1)
}

export function visibleNav(role: string | undefined): NavItem[] {
  return NAV_ITEMS.filter(item => canAccessView(item.id, role))
}

// ── Onglets du bas : 4 à 5 tâches quotidiennes par rôle ──────────────
export type TabBadge = 'transfers' | 'notifications'
export interface TabItem { id: string; label: string; icon: LucideIcon; badge?: TabBadge }

const HOME: TabItem = { id: 'dashboard', label: 'Accueil', icon: LayoutDashboard }
const RECEPTIONS: TabItem = { id: 'transfer-validations', label: 'Réceptions', icon: Inbox, badge: 'transfers' }

export const TABS_BY_ROLE: Record<string, TabItem[]> = {
  MEMBRE: [
    HOME,
    { id: 'rubriques', label: 'Rubriques', icon: FolderOpen },
    { id: 'notifications', label: 'Alertes', icon: Bell, badge: 'notifications' },
    { id: 'mon-profil', label: 'Profil', icon: UserCircle },
  ],
  COLLECTEUR: [
    HOME,
    { id: 'contributions', label: 'Encaisser', icon: HandCoins },
    { id: 'validations', label: 'Validations', icon: UserCheck },
    { id: 'collecteurs', label: 'Mes fonds', icon: Wallet },
    RECEPTIONS,
  ],
  ADJOINT_RESPONSABLE: [HOME, { id: 'validations', label: 'Validations', icon: UserCheck }, { id: 'litiges', label: 'Litiges', icon: AlertTriangle }, { id: 'membres', label: 'Membres', icon: Users }, RECEPTIONS],
  RESPONSABLE: [HOME, { id: 'validations', label: 'Validations', icon: UserCheck }, { id: 'litiges', label: 'Litiges', icon: AlertTriangle }, { id: 'membres', label: 'Membres', icon: Users }, RECEPTIONS],
  TRESORIER: [HOME, { id: 'validations', label: 'Validations', icon: UserCheck }, { id: 'collecteurs', label: 'Fonds', icon: Wallet }, RECEPTIONS, { id: 'rapports', label: 'Rapports', icon: FileText }],
  ADMIN: [HOME, { id: 'contributions', label: 'Contributions', icon: CreditCard }, { id: 'membres', label: 'Membres', icon: Users }, { id: 'utilisateurs', label: 'Comptes', icon: UserCog }, RECEPTIONS],
  DEVELOPER: [HOME, { id: 'contributions', label: 'Contributions', icon: CreditCard }, { id: 'utilisateurs', label: 'Comptes', icon: UserCog }, { id: 'developer', label: 'Dév.', icon: Terminal }, RECEPTIONS],
}

export function tabsFor(role: string | undefined): TabItem[] {
  return (TABS_BY_ROLE[role ?? ''] ?? [HOME]).filter(tab => canAccessView(tab.id, role))
}
