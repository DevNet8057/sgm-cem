'use client'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut, X } from 'lucide-react'
import { Badge, Drawer, Layout, Menu, type MenuProps } from 'antd'
import { motion } from 'framer-motion'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { BrandMark } from '@/components/ui/BrandMark'
import { Avatar } from '@/components/ui/Avatar'
import { cn, ROLE_LABELS } from '@/lib/utils'
import { SECTIONS, SECTION_LABELS, visibleNav } from '@/lib/navigation'

export function Sidebar() {
  const { activeView, setActiveView, sidebarOpen, setSidebarOpen, unreadCount, pendingTransfersCount } = useAppStore()
  const { user, logout } = useAuthStore()

  const filteredNav = visibleNav(user?.role)

  // Menu plus long que l'écran : indice « suite en bas » et élément actif ramené à l'écran
  const navRef = useRef<HTMLElement>(null)
  const [moreBelow, setMoreBelow] = useState(false)
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const update = () => setMoreBelow(nav.scrollTop + nav.clientHeight < nav.scrollHeight - 4)
    update()
    nav.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => { nav.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  }, [filteredNav.length])
  useEffect(() => {
    navRef.current?.querySelector('.ant-menu-item-selected')?.scrollIntoView({ block: 'nearest' })
  }, [activeView])

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
      // Titre de section stylé ici plutôt que par sélecteur interne .ant-menu-*
      label: SECTION_LABELS[section]
        ? <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">{SECTION_LABELS[section]}</span>
        : undefined,
      children: items.map(item => {
        const Icon = item.icon
        const count = item.id === 'transfer-validations' ? pendingTransfersCount : item.id === 'notifications' ? unreadCount : 0

        return {
          key: item.id,
          icon: <Icon size={17} className={cn('shrink-0', item.id === activeView ? 'text-[#0F4A0F]' : 'text-white/65')} />,
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
            height: 34,
            lineHeight: '34px',
            marginBlock: 2,
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
      <div className="flex min-h-[64px] items-center justify-between border-b border-white/10 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
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
        <div className="border-b border-white/[0.06] px-4 py-2">
          <Badge color="#F5C400" text={<span className="text-[11px] font-semibold text-[#F8D94E]">{ROLE_LABELS[user.role] ?? user.role}</span>} />
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">
      <nav ref={navRef} className="scrollbar-thin flex-1 overflow-y-auto px-2 py-2" aria-label="Navigation principale">
        <Menu
          mode="inline"
          theme="dark"
          selectable
          selectedKeys={[activeView]}
          onClick={handleMenuClick}
          className="border-0 bg-transparent!"
          items={menuItems}
        />
      </nav>
      {moreBelow && (
        <button
          type="button"
          onClick={() => navRef.current?.scrollBy({ top: navRef.current.clientHeight * 0.6, behavior: 'smooth' })}
          className="absolute inset-x-0 bottom-0 flex h-10 items-end justify-center bg-gradient-to-t from-[#0f5721] to-transparent pb-1 text-white/70 hover:text-white"
          aria-label="Afficher la suite du menu"
        >
          <ChevronDown size={18} className="animate-bounce" aria-hidden />
        </button>
      )}
      </div>

      {user && (
        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.06] p-2.5">
            <Avatar
              name={user.fullName}
              src={user.photoUrl}
              size={36}
              override={{ bg: '#F5C400', text: '#0F4A0F' }}
              className="shrink-0"
            />
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
        size="min(88vw, 300px)"
        closable={false}
        destroyOnHidden
        rootClassName="lg:hidden"
        styles={{ body: { padding: 0 }, section: { background: 'transparent' }, mask: { backdropFilter: 'blur(4px)' } }}
      >
        {sidebarContent}
      </Drawer>
    </>
  )
}
