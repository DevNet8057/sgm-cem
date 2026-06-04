'use client'
import {
  LayoutDashboard, FolderOpen, CreditCard, Wallet, UserCheck,
  Users, Archive, Briefcase, AlertTriangle, BarChart3, FileText,
  Bell, Settings, LogOut, X
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { cn, getInitials, ROLE_LABELS, ROLE_LEVELS } from '@/lib/utils'

const NAV_ITEMS = [
  { id: 'dashboard',      label: 'Tableau de Bord',  icon: LayoutDashboard, section: 'NAVIGATION',   minLevel: 1 },
  { id: 'rubriques',      label: 'Rubriques',         icon: FolderOpen,      section: 'FINANCES',     minLevel: 1 },
  { id: 'contributions',  label: 'Contributions',     icon: CreditCard,      section: 'FINANCES',     minLevel: 2 },
  { id: 'collecteurs',    label: 'Fonds Collecteurs', icon: Wallet,          section: 'FINANCES',     minLevel: 3 },
  { id: 'validations',    label: 'Validations',       icon: UserCheck,       section: 'FINANCES',     minLevel: 2 },
  { id: 'membres',        label: 'Membres',           icon: Users,           section: 'MEMBRES',      minLevel: 2 },
  { id: 'ged',            label: 'GED Commissions',   icon: Archive,         section: 'GESTION',      minLevel: 2 },
  { id: 'prestations',    label: 'Prestations',       icon: Briefcase,       section: 'GESTION',      minLevel: 2 },
  { id: 'litiges',        label: 'Litiges',           icon: AlertTriangle,   section: 'GESTION',      minLevel: 3 },
  { id: 'statistiques',   label: 'Statistiques',      icon: BarChart3,       section: 'OUTILS',       minLevel: 3 },
  { id: 'rapports',       label: 'Rapports',          icon: FileText,        section: 'OUTILS',       minLevel: 3 },
  { id: 'notifications',  label: 'Notifications',     icon: Bell,            section: 'OUTILS',       minLevel: 1 },
  { id: 'parametres',     label: 'Paramètres',        icon: Settings,        section: 'SYSTEME',      minLevel: 5 },
]

const SECTIONS = ['NAVIGATION', 'FINANCES', 'MEMBRES', 'GESTION', 'OUTILS', 'SYSTEME']
const SECTION_LABELS: Record<string, string> = {
  NAVIGATION: '', FINANCES: 'Finances', MEMBRES: 'Membres',
  GESTION: 'Gestion', OUTILS: 'Outils', SYSTEME: 'Système',
}

export function Sidebar() {
  const { activeView, setActiveView, sidebarOpen, setSidebarOpen, unreadCount } = useAppStore()
  const { user, logout } = useAuthStore()

  const userLevel = ROLE_LEVELS[user?.role ?? ''] ?? 1

  const filteredNav = NAV_ITEMS.filter(item => userLevel >= item.minLevel)

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
            <div className="w-9 h-9 rounded-[10px] bg-[#F5C400] flex items-center justify-center flex-shrink-0">
              <span className="text-[#0F4A0F] font-black text-sm font-display">CEM</span>
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
                        'w-full flex items-center gap-3 px-4 py-2.5 mx-2 rounded-[10px] text-sm font-medium transition-all duration-200 relative group',
                        'hover:bg-white/10',
                        active ? 'text-[#0F4A0F] font-semibold' : 'text-white/70 hover:text-white'
                      )}
                      style={active ? {
                        background: '#F5C400',
                        boxShadow: '0 4px 16px rgba(245,196,0,0.3)',
                        width: 'calc(100% - 16px)',
                      } : { width: 'calc(100% - 16px)' }}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[#0F4A0F]/60 rounded-full -ml-2" />
                      )}
                      <Icon size={16} className="flex-shrink-0" />
                      <span className="flex-1 text-left text-xs">{item.label}</span>
                      {item.id === 'notifications' && unreadCount > 0 && (
                        <span className={cn(
                          'text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center',
                          active ? 'bg-[#0F4A0F]/20 text-[#0F4A0F]' : 'bg-red-500 text-white'
                        )}>
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      )}
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
                <p className="text-white/50 text-[10px] truncate">{ROLE_LABELS[user.role]}</p>
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
