'use client'
import {
  LayoutDashboard, FolderOpen, CreditCard, Wallet, UserCheck, Shield,
  Users, Archive, Briefcase, AlertTriangle, BarChart3, FileText,
  Bell, Settings, LogOut, X, UserCog, CreditCard as CardIcon, UserCircle, Terminal, History, Globe,
} from 'lucide-react'
import { Avatar, Badge, Drawer, Layout, Menu, type MenuProps } from 'antd'
import { motion, useReducedMotion } from 'framer-motion'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { BrandMark } from '@/components/ui/BrandMark'
import { getInitials, ROLE_LABELS, ROLE_LEVELS } from '@/lib/utils'

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
export function Sidebar() {
  const { activeView, setActiveView, sidebarOpen, setSidebarOpen, unreadCount, pendingTransfersCount } = useAppStore()
  const { user, logout } = useAuthStore()
  const reduceMotion = useReducedMotion()

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

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    setActiveView(key)
    setSidebarOpen(false)
  }

  const menuItems: MenuProps['items'] = SECTIONS.flatMap(section => {
    const items = filteredNav.filter(item => item.section === section)
    if (!items.length) return []

    return [{
      type: 'group' as const,
      key: section,
      label: SECTION_LABELS[section] || undefined,
      children: items.map(item => {
        const Icon = item.icon
        const count = item.id === 'transfer-validations' ? pendingTransfersCount : item.id === 'notifications' ? unreadCount : 0

        return {
          key: item.id,
          icon: <Icon size={17} className="shrink-0 text-white/65" />,
          label: (
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex-1 truncate text-xs font-medium">{item.label}</span>
              {count > 0 && (
                <Badge
                  count={count > 9 ? '9+' : count}
                  overflowCount={9}
                  styles={{ indicator: { backgroundColor: '#ef4444', color: '#fff', boxShadow: 'none' } }}
                />
              )}
            </span>
          ),
          style: {
            height: 40,
            lineHeight: '40px',
            marginInline: 0,
            width: '100%',
            borderRadius: 10,
            color: activeView === item.id ? '#0F4A0F' : undefined,
            background: activeView === item.id ? '#F5C400' : undefined,
            boxShadow: activeView === item.id ? '0 6px 20px rgba(245,196,0,0.22)' : undefined,
          },
        }
      }),
    }]
  })

  const sidebarContent = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#041b0a_0%,#0b3d18_48%,#0f5721_100%)] text-white">
      <div className="flex min-h-[76px] items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.25 }}
            className="shrink-0"
          >
            <BrandMark size={40} variant="compact" alt="Logo CEM" />
          </motion.div>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold leading-tight text-white">Culte d&apos;Enfants</p>
            <p className="mt-1 truncate text-[11px] text-white/50">EEC Melen · SGM</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
          aria-label="Fermer le menu"
        >
          <X size={18} />
        </button>
      </div>

      {user && (
        <div className="border-b border-white/[0.06] px-4 py-3">
          <Badge color="#F5C400" text={<span className="text-[11px] font-semibold text-[#F8D94E]">{ROLE_LABELS[user.role] ?? user.role}</span>} />
        </div>
      )}

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 py-3" aria-label="Navigation principale">
        <Menu
          mode="inline"
          theme="dark"
          selectable
          selectedKeys={[activeView]}
          onClick={handleMenuClick}
          className="border-0 bg-transparent! [&_.ant-menu-item-group]:mb-2! [&_.ant-menu-item-group-title]:px-3! [&_.ant-menu-item-group-title]:pb-1! [&_.ant-menu-item-group-title]:pt-2! [&_.ant-menu-item-group-title]:text-[10px]! [&_.ant-menu-item-group-title]:font-bold! [&_.ant-menu-item-group-title]:uppercase [&_.ant-menu-item-group-title]:tracking-[0.18em]! [&_.ant-menu-item-group-title]:text-white/35! [&_.ant-menu-item-selected_.ant-menu-item-icon]:text-[#0F4A0F]!"
          items={menuItems}
        />
      </nav>

      {user && (
        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.06] p-2.5">
            <Avatar
              size={36}
              src={user.photoUrl}
              className="shrink-0 bg-[#F5C400]! font-bold text-[#0F4A0F]!"
            >
              {getInitials(user.fullName)}
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white">{user.firstName}</p>
              <p className="mt-0.5 truncate text-[10px] text-white/45">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={() => logout()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/45 transition-colors hover:bg-red-400/10 hover:text-red-300"
              title="Déconnexion"
              aria-label="Déconnexion"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <>
      <Layout.Sider
        width="var(--sidebar-w)"
        className="hidden! min-h-screen! shrink-0! bg-transparent! lg:block!"
        theme="dark"
      >
        <div className="fixed inset-y-0 left-0" style={{ width: 'var(--sidebar-w)' }}>
          {sidebarContent}
        </div>
      </Layout.Sider>

      <Drawer
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        placement="left"
        width="min(88vw, 300px)"
        closable={false}
        destroyOnHidden
        rootClassName="lg:hidden"
        styles={{ body: { padding: 0 }, content: { background: 'transparent' }, mask: { backdropFilter: 'blur(4px)' } }}
      >
        {sidebarContent}
      </Drawer>
    </>
  )
}
