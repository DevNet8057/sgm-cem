'use client'
import {
  LayoutDashboard, FolderOpen, CreditCard, Wallet, UserCheck, Shield,
  Users, Archive, Briefcase, AlertTriangle, BarChart3, FileText,
  Bell, Settings, LogOut, X, UserCog, CreditCard as CardIcon, UserCircle, Terminal, History,
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { cn, getInitials, ROLE_LABELS, ROLE_LEVELS } from '@/lib/utils'

// ─── Navigation par rôle ─────────────────────────────────────────────
// minLevel : niveau minimum pour voir l'item
// roles : liste de rôles exclusifs (si défini, remplace minLevel)
const NAV_ITEMS = [
  // ── Accueil ─────────────────────────────────────────────────────────
  { id: 'dashboard',       label: 'Tableau de Bord',    icon: LayoutDashboard, section: 'NAVIGATION',   minLevel: 1 },
  // ── Finances ────────────────────────────────────────────────────────
  { id: 'rubriques',       label: 'Rubriques',           icon: FolderOpen,      section: 'FINANCES',     minLevel: 1, excludeRoles: ['MEMBRE'] },
  { id: 'contributions',   label: 'Contributions',       icon: CreditCard,      section: 'FINANCES',     minLevel: 2, excludeRoles: ['MEMBRE'] },
  { id: 'collecteurs',     label: 'Fonds Collecteurs',   icon: Wallet,          section: 'FINANCES',     minLevel: 2 },
  { id: 'validations',     label: 'Validations',         icon: UserCheck,      section: 'FINANCES',     minLevel: 2, excludeRoles: ['MEMBRE'] },
  { id: 'transfer-validations', label: 'Fonds à réceptionner', icon: Shield,          section: 'FINANCES',     minLevel: 2, excludeRoles: ['MEMBRE'] },
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
  // ── Système ─────────────────────────────────────────────────────────
  { id: 'utilisateurs',    label: 'Utilisateurs',        icon: UserCog,         section: 'SYSTEME',      roles: ['ADMIN', 'DEVELOPER'] },
  { id: 'parametres',      label: 'Paramètres',          icon: Settings,        section: 'SYSTEME',      roles: ['ADMIN', 'DEVELOPER'] },
  // Panneau développeur — rôle DEVELOPER exclusivement (jamais ADMIN)
  { id: 'developer',       label: 'Développeur',         icon: Terminal,        section: 'SYSTEME',      roles: ['DEVELOPER'] },
  // ── Mon compte ──────────────────────────────────────────────────────
  { id: 'mon-profil',      label: 'Mon Profil',          icon: UserCircle,      section: 'MON_COMPTE',   minLevel: 1 },
]

const SECTIONS = ['NAVIGATION', 'FINANCES', 'MEMBRES', 'MON_ESPACE', 'GESTION', 'OUTILS', 'SYSTEME', 'MON_COMPTE']
const SECTION_LABELS: Record<string, string> = {
  NAVIGATION: '', FINANCES: 'Finances', MEMBRES: 'Membres',
  MON_ESPACE: 'Mon espace', GESTION: 'Gestion', OUTILS: 'Outils',
  SYSTEME: 'Système', MON_COMPTE: 'Mon compte',
}
// Icon color by domain (visible on dark sidebar, A3)
const SECTION_ICON_COLOR: Record<string, string> = {
  NAVIGATION: 'text-white',
  FINANCES:   'text-emerald-400',
  MEMBRES:    'text-blue-400',
  MON_ESPACE: 'text-blue-400',
  GESTION:    'text-purple-400',
  OUTILS:     'text-amber-400',
  SYSTEME:    'text-slate-400',
  MON_COMPTE: 'text-slate-400',
}

export function Sidebar() {
  const { activeView, setActiveView, sidebarOpen, setSidebarOpen, unreadCount, pendingTransfersCount } = useAppStore()
  const { user, logout } = useAuthStore()

  const userLevel = ROLE_LEVELS[user?.role ?? ''] ?? 1
  const userRole  = user?.role ?? ''

  const filteredNav = NAV_ITEMS.filter(item => {
    // Rôles exclusifs
    if (item.roles) return item.roles.includes(userRole)
    // Rôles exclus
    if (item.excludeRoles?.includes(userRole)) return false
    // Niveau minimum
    return userLevel >= (item.minLevel ?? 1)
  })

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[300] lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={cn(
        'fixed left-0 top-0 h-full z-[400] flex flex-col transition-transform duration-300',
        'lg:translate-x-0 lg:static lg:z-auto',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      )}
        style={{
          width: 'var(--sidebar-w)',
          background: 'linear-gradient(180deg, #052005 0%, #0F4A0F 30%, #1A6B1A 100%)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-white flex items-center justify-center flex-shrink-0 shadow-cem-yellow overflow-hidden p-1">
              <img src="/icon-192.png" alt="Logo CEM" className="w-full h-full object-contain" />
            </div>
            <div>
              <p className="text-white font-semibold text-sm leading-tight font-display">Culte d'Enfants</p>
              <p className="text-white/50 text-xs">EEC Melen · SGM</p>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-white/60 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Rôle badge */}
        {user && (
          <div className="px-4 py-2.5 border-b border-white/5">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#F5C400] bg-[#F5C400]/10 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[#F5C400]" />
              {ROLE_LABELS[user.role] ?? user.role}
            </span>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto scrollbar-thin py-3">
          {SECTIONS.map(section => {
            const items = filteredNav.filter(i => i.section === section)
            if (!items.length) return null
            return (
              <div key={section} className="mb-1">
                {SECTION_LABELS[section] && (
                  <p className="px-4 pt-3 pb-1.5 text-[10px] font-bold text-white/30 uppercase tracking-widest">
                    {SECTION_LABELS[section]}
                  </p>
                )}
                {items.map(item => {
                  const active = activeView === item.id
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      onClick={() => { setActiveView(item.id); setSidebarOpen(false) }}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-2.5 mx-2 rounded-[10px] text-sm font-medium transition-all duration-200 relative',
                        'hover:bg-white/10',
                        active ? 'text-[#0F4A0F] font-semibold' : 'text-white/70 hover:text-white'
                      )}
                      style={active ? {
                        background: '#F5C400',
                        boxShadow: '0 4px 16px rgba(245,196,0,0.3)',
                        width: 'calc(100% - 16px)',
                      } : { width: 'calc(100% - 16px)' }}
                    >
                      <Icon size={16} className={cn('flex-shrink-0', !active && SECTION_ICON_COLOR[section])} />
                      <span className="flex-1 text-left text-xs">{item.label}</span>
                      {(item.id === 'notifications' && unreadCount > 0) || (item.id === 'transfer-validations' && pendingTransfersCount > 0) ? (
                        <span className={cn(
                          'text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center',
                          active ? 'bg-[#0F4A0F]/20 text-[#0F4A0F]' : 'bg-red-500 text-white'
                        )}>
                          {item.id === 'transfer-validations' ? (pendingTransfersCount > 9 ? '9+' : pendingTransfersCount) : (unreadCount > 9 ? '9+' : unreadCount)}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </nav>

        {/* Footer */}
        {user && (
          <div className="p-4 border-t border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-[8px] bg-[#F5C400] flex items-center justify-center flex-shrink-0">
                <span className="text-[#0F4A0F] font-bold text-xs">{getInitials(user.fullName)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-semibold truncate">{user.firstName}</p>
                <p className="text-white/50 text-[10px] truncate">{user.email}</p>
              </div>
              <button onClick={() => logout()} className="text-white/40 hover:text-red-300 transition-colors" title="Déconnexion">
                <LogOut size={15} />
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
