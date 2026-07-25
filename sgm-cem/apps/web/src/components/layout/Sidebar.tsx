'use client'
import { LogOut, X } from 'lucide-react'
import { Badge, Button, Drawer, Layout, Menu, Tooltip, type MenuProps } from 'antd'
import { motion, useReducedMotion } from 'framer-motion'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { useThemeStore } from '@/store/themeStore'
import { BrandMark } from '@/components/ui/BrandMark'
import { Avatar } from '@/components/ui/Avatar'
import { ROLE_LABELS } from '@/lib/utils'
import {
  getNavigationForRole,
  NAVIGATION_SECTION_LABELS,
  NAVIGATION_SECTIONS,
} from '@/config/navigation'

export function Sidebar() {
  const { activeView, setActiveView, sidebarOpen, setSidebarOpen, unreadCount, pendingTransfersCount } = useAppStore()
  const { user, logout } = useAuthStore()
  const { theme } = useThemeStore()
  const menuTheme = theme === 'light' ? 'light' : 'dark'
  const reduceMotion = useReducedMotion()

  const filteredNav = user ? getNavigationForRole(user.role) : []
  const visibleShortcuts = filteredNav.filter(item =>
    item.id === 'membres' || item.id === 'contributions' || item.id === 'rapports'
  )

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    setActiveView(key)
    setSidebarOpen(false)
  }

  const menuItems: MenuProps['items'] = NAVIGATION_SECTIONS.flatMap(section => {
    const items = filteredNav.filter(item => item.section === section)
    if (!items.length) return []

    return [{
      type: 'group' as const,
      key: section,
      label: NAVIGATION_SECTION_LABELS[section] || undefined,
      children: items.map(item => {
        const Icon = item.icon
        const count = item.id === 'transfer-validations' ? pendingTransfersCount : item.id === 'notifications' ? unreadCount : 0

        return {
          key: item.id,
          icon: <Icon size={17} className="shrink-0 text-dash-textMuted" />,
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
            borderRadius: 14,
          },
        }
      }),
    }]
  })

  const sidebarContent = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-dash-sidebar text-dash-text">
      <div className="flex min-h-[76px] items-center justify-between border-b border-dash-border px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.25 }}
            className="shrink-0"
          >
            <BrandMark size={40} variant="compact" alt="Logo CEM" />
          </motion.div>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold leading-tight text-dash-text">Culte d&apos;Enfants</p>
            <p className="mt-1 truncate text-[11px] text-dash-text/50">EEC Melen · SGM</p>
          </div>
        </div>
        <Button
          type="text"
          htmlType="button"
          onClick={() => setSidebarOpen(false)}
          className="flex! h-9! w-9! min-w-9! items-center! justify-center! rounded-lg! text-dash-textMuted! transition-colors! hover:bg-dash-cardHover! hover:text-dash-text! lg:hidden!"
          aria-label="Fermer le menu"
          icon={<X size={18} />}
        >
        </Button>
      </div>

      {user && (
        <div className="border-b border-dash-border px-4 py-3">
          <Badge color="#FACC15" text={<span className="text-[11px] font-semibold text-dash-warning">{ROLE_LABELS[user.role] ?? user.role}</span>} />
        </div>
      )}

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 py-3" aria-label="Navigation principale">
        <Menu
          mode="inline"
          theme={menuTheme}
          selectable
          selectedKeys={[activeView]}
          onClick={handleMenuClick}
          className="border-0 bg-transparent! [&_.ant-menu-item-group]:mb-2! [&_.ant-menu-item-group-title]:px-3! [&_.ant-menu-item-group-title]:pb-1! [&_.ant-menu-item-group-title]:pt-2! [&_.ant-menu-item-group-title]:text-[10px]! [&_.ant-menu-item-group-title]:font-bold! [&_.ant-menu-item-group-title]:uppercase [&_.ant-menu-item-group-title]:tracking-[0.18em]! [&_.ant-menu-item-group-title]:text-dash-textMuted/70! [&_.ant-menu-item-selected]:text-dash-text! [&_.ant-menu-item-selected_.ant-menu-item-icon]:text-[#86EFAC]!"
          items={menuItems}
        />
      </nav>

      {visibleShortcuts.length > 0 && (
        <div className="border-t border-dash-border px-4 py-3">
          <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.18em] text-dash-textMuted/70">Raccourcis</p>
          <div className="flex flex-col gap-1.5">
            {visibleShortcuts.map(item => (
              <Button
                key={item.id}
                type="text"
                htmlType="button"
                onClick={() => { setActiveView(item.id); setSidebarOpen(false) }}
                className="flex! h-auto! items-center! justify-start! gap-2! rounded-dash-btn! bg-dash-card! px-3! py-2! text-left! text-xs! font-semibold! text-dash-text! transition-colors! hover:bg-dash-cardHover!"
              >
                <item.icon size={15} className="shrink-0 text-dash-primary" />
                <span className="truncate">
                  {item.id === 'membres'
                    ? 'Membres'
                    : item.id === 'contributions'
                      ? 'Contributions'
                      : 'Rapports'}
                </span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {user && (
        <div className="border-t border-dash-border p-4">
          <div className="flex items-center gap-3 rounded-xl bg-dash-card p-2.5">
            <Avatar
              name={user.fullName}
              src={user.photoUrl}
              size={36}
              override={{ bg: '#2ECC71', text: '#07120D' }}
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-dash-text">{user.firstName}</p>
              <p className="mt-0.5 truncate text-[10px] text-dash-textMuted">{user.email}</p>
            </div>
            <Tooltip title="Déconnexion" placement="top">
              <Button
                type="text"
                htmlType="button"
                onClick={() => logout()}
                className="flex! h-8! w-8! min-w-8! shrink-0! items-center! justify-center! rounded-lg! text-dash-text/45! transition-colors! hover:bg-red-400/10! hover:text-red-300!"
                aria-label="Déconnexion"
                icon={<LogOut size={16} />}
              />
            </Tooltip>
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
        theme={menuTheme}
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
