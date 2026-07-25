'use client'
import { useMemo, useRef, useState } from 'react'
import { Bell, ChevronDown, LogOut, Menu as MenuIcon, Moon, Search, Sun, UserCircle } from 'lucide-react'
import { Badge, Button, Dropdown, Input, Tooltip, type MenuProps } from 'antd'
import { motion, useReducedMotion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { useThemeStore } from '@/store/themeStore'
import { ROLE_LABELS } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { getNavigationForRole, getViewTitle, type ViewId } from '@/config/navigation'
import type { ApiResponse, Notification } from '@/types'

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .trim()
}

function playNotifSound() {
  try {
    const soundId = localStorage.getItem('cem-notif-sound') ?? 'bip'
    if (soundId === 'off') return

    type WebkitAudio = typeof AudioContext
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: WebkitAudio }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()

    if (soundId === 'double') {
      ;[0, 0.18].forEach(delay => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.type = 'sine'; osc.frequency.value = 1050
        gain.gain.setValueAtTime(0.2, ctx.currentTime + delay)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.12)
        osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.14)
      })
      setTimeout(() => void ctx.close(), 500)
      return
    }

    const osc = ctx.createOscillator(); const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)

    if (soundId === 'aigu') {
      osc.type = 'sine'; osc.frequency.value = 1400
      gain.gain.setValueAtTime(0.18, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
      osc.start(); osc.stop(ctx.currentTime + 0.2)
    } else if (soundId === 'grave') {
      osc.type = 'triangle'; osc.frequency.value = 440
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start(); osc.stop(ctx.currentTime + 0.4)
    } else {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.25)
      gain.gain.setValueAtTime(0.18, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
      osc.start(); osc.stop(ctx.currentTime + 0.35)
    }
    void ctx.close()
  } catch {}
}

export function TopBar() {
  const { setSidebarOpen, setActiveView, setNotifications, addToast, activeView, unreadCount } = useAppStore()
  const { user, logout } = useAuthStore()
  const { theme, toggleTheme } = useThemeStore()
  const reduceMotion = useReducedMotion()
  const seenIds = useRef<Set<string>>(new Set())
  const firstLoad = useRef(true)
  const [navigationQuery, setNavigationQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  const navigationItems = useMemo(
    () => (user ? getNavigationForRole(user.role) : []),
    [user]
  )
  const searchResults = useMemo(() => {
    const query = normalizeSearch(navigationQuery)
    if (!query) return []

    return navigationItems
      .filter(item => normalizeSearch(`${item.label} ${item.title}`).includes(query))
      .slice(0, 6)
  }, [navigationItems, navigationQuery])
  const currentView = navigationItems.some(item => item.id === activeView)
    ? activeView as ViewId
    : undefined
  const currentTitle = currentView ? getViewTitle(currentView) : 'SGM-CEM'

  function openView(view: ViewId) {
    setActiveView(view)
    setNavigationQuery('')
    setSearchOpen(false)
  }

  const navigationMenuItems: MenuProps['items'] = searchResults.map(item => {
    const Icon = item.icon

    return {
      key: item.id,
      icon: <Icon size={16} />,
      label: item.title,
    }
  })

  useQuery({
    queryKey: ['notifications'],
    enabled: Boolean(user),
    queryFn: async () => {
      const res = await api.get<ApiResponse<Notification[]>>('/notifications')
      const notifications = res.data.data ?? []
      setNotifications(notifications)

      const newOnes = notifications.filter(n => !n.isRead && !seenIds.current.has(n.id))
      if (newOnes.length > 0 && !firstLoad.current) {
        newOnes.forEach(n => {
          addToast({ title: n.title, message: n.body, variant: 'info', duration: 5000 })
        })
        playNotifSound()
      }

      notifications.forEach(n => seenIds.current.add(n.id))
      firstLoad.current = false

      return notifications
    },
    refetchInterval: 30000,
  })

  const profileItems: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserCircle size={16} />,
      label: 'Mon profil',
      onClick: () => setActiveView('mon-profil'),
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogOut size={16} />,
      label: 'Déconnexion',
      danger: true,
      onClick: () => void logout(),
    },
  ]

  return (
    <header className="sticky top-0 z-[200] shrink-0 px-3 pt-3 sm:px-5">
      <div className="flex min-h-16 items-center gap-2 rounded-[20px] border border-dash-border bg-dash-sidebar/90 px-2.5 shadow-dash backdrop-blur-xl sm:gap-3 sm:px-4">
        <Tooltip title="Ouvrir le menu" placement="bottom">
          <Button
            type="text"
            shape="circle"
            icon={<MenuIcon size={20} />}
            onClick={() => setSidebarOpen(true)}
            className="h-11! w-11! shrink-0 text-dash-textMuted! hover:bg-dash-cardHover! hover:text-dash-text! lg:hidden!"
            aria-label="Ouvrir le menu de navigation"
          />
        </Tooltip>

        <motion.div
          key={activeView}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
          className="min-w-0 flex-1"
        >
          <p className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-dash-textMuted sm:block">SGM-CEM</p>
          <p className="truncate font-display text-base font-semibold leading-tight text-dash-text">
            {currentTitle}
          </p>
        </motion.div>

        <div className="hidden w-full max-w-[300px] lg:block">
          <Dropdown
            open={searchOpen && navigationQuery.trim().length > 0 && searchResults.length > 0}
            onOpenChange={setSearchOpen}
            trigger={[]}
            menu={{
              items: navigationMenuItems,
              onClick: ({ key }) => openView(key as ViewId),
            }}
            placement="bottomLeft"
          >
            <Input
              value={navigationQuery}
              onChange={event => {
                setNavigationQuery(event.target.value)
                setSearchOpen(true)
              }}
              onFocus={() => setSearchOpen(true)}
              onPressEnter={() => {
                const firstResult = searchResults[0]
                if (firstResult) openView(firstResult.id)
              }}
              allowClear
              prefix={<Search size={16} aria-hidden="true" />}
              placeholder="Rechercher une rubrique…"
              aria-label="Rechercher dans la navigation"
              aria-haspopup="menu"
              aria-expanded={searchOpen && searchResults.length > 0}
              className="h-11! bg-dash-card/80!"
            />
          </Dropdown>
        </div>

        <Tooltip title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'} placement="bottom">
          <Button
            type="text"
            shape="circle"
            icon={theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            onClick={toggleTheme}
            className="inline-flex! h-11! w-11! shrink-0! text-dash-textMuted! hover:bg-dash-cardHover! hover:text-dash-text!"
            aria-pressed={theme === 'light'}
            aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
          />
        </Tooltip>

        <Tooltip title="Notifications" placement="bottom">
          <Badge count={unreadCount > 9 ? '9+' : unreadCount} overflowCount={9} size="small" offset={[-2, 3]}>
            <Button
              type="text"
              shape="circle"
              icon={<Bell size={18} />}
              onClick={() => setActiveView('notifications')}
              className="h-11! w-11! text-dash-textMuted! hover:bg-dash-cardHover! hover:text-dash-text!"
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} non lue${unreadCount > 1 ? 's' : ''}` : 'Notifications'}
            />
          </Badge>
        </Tooltip>

        {user && (
          <Dropdown menu={{ items: profileItems }} placement="bottomRight" trigger={['click']}>
            <Button
              type="text"
              className="flex! h-11! items-center! gap-2! rounded-xl! px-1.5! text-left hover:bg-dash-cardHover! sm:px-2!"
              aria-label="Ouvrir le menu du profil"
            >
              <Avatar
                name={user.fullName}
                src={user.photoUrl}
                size={34}
                override={{ bg: '#2ECC71', text: '#07120D' }}
                className="shrink-0"
              />
              <span className="hidden min-w-0 md:block">
                <span className="block max-w-32 truncate text-xs font-semibold leading-tight text-dash-text">{user.firstName}</span>
                <span className="mt-0.5 block max-w-32 truncate text-[10px] leading-tight text-dash-textMuted">{ROLE_LABELS[user.role] ?? user.role}</span>
              </span>
              <ChevronDown size={14} className="hidden shrink-0 text-dash-textMuted md:block" />
            </Button>
          </Dropdown>
        )}
      </div>
    </header>
  )
}
