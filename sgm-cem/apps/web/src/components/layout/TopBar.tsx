'use client'
import { useRef } from 'react'
import { Bell, ChevronDown, LogOut, Menu as MenuIcon, UserCircle } from 'lucide-react'
import { Badge, Button, Dropdown, Tooltip, type MenuProps } from 'antd'
import { motion, useReducedMotion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { ROLE_LABELS } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import type { ApiResponse, Notification } from '@/types'

const VIEW_TITLES: Record<string, string> = {
  dashboard: 'Tableau de bord',
  rubriques: 'Rubriques',
  contributions: 'Contributions',
  collecteurs: 'Fonds collecteurs',
  validations: 'Validations en attente',
  'transfer-validations': 'Fonds à réceptionner',
  'collectes-publiques': 'Collectes publiques',
  membres: 'Gestion des membres',
  'mes-contributions': 'Mes contributions',
  ged: 'GED Commissions',
  prestations: 'Prestations de génie',
  litiges: 'Gestion des litiges',
  statistiques: 'Statistiques et analyses',
  rapports: 'Rapports',
  notifications: 'Notifications',
  journal: "Journal d'activité",
  utilisateurs: 'Utilisateurs',
  parametres: 'Paramètres système',
  developer: 'Espace développeur',
  'mon-profil': 'Mon profil',
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
  const reduceMotion = useReducedMotion()
  const seenIds = useRef<Set<string>>(new Set())
  const firstLoad = useRef(true)

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
    <header
      className="sticky top-0 z-[200] flex h-16 items-center gap-2 border-b border-slate-200/80 bg-white/85 px-3 shadow-[0_1px_0_rgba(15,74,15,0.03)] backdrop-blur-xl sm:gap-3 sm:px-5"
    >
      <Tooltip title="Ouvrir le menu" placement="bottom">
        <Button
          type="text"
          shape="circle"
          icon={<MenuIcon size={20} />}
          onClick={() => setSidebarOpen(true)}
          className="h-11! w-11! shrink-0 text-slate-600! hover:bg-emerald-50! hover:text-[#0F4A0F]! lg:hidden!"
          aria-label="Ouvrir le menu de navigation"
        />
      </Tooltip>

      <motion.div
        key={activeView}
        initial={reduceMotion ? false : { opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.2 }}
        className="min-w-0 flex-1"
      >
        <p className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 sm:block">SGM-CEM</p>
        <p className="truncate font-display text-base font-semibold leading-tight text-[#0F4A0F]">
          {VIEW_TITLES[activeView] ?? 'SGM-CEM'}
        </p>
      </motion.div>

      <Tooltip title="Notifications" placement="bottom">
        <Badge count={unreadCount > 9 ? '9+' : unreadCount} overflowCount={9} size="small" offset={[-2, 3]}>
          <Button
            type="text"
            shape="circle"
            icon={<Bell size={18} />}
            onClick={() => setActiveView('notifications')}
            className="h-11! w-11! text-slate-600! hover:bg-emerald-50! hover:text-[#0F4A0F]!"
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} non lue${unreadCount > 1 ? 's' : ''}` : 'Notifications'}
          />
        </Badge>
      </Tooltip>

      {user && (
        <Dropdown menu={{ items: profileItems }} placement="bottomRight" trigger={['click']}>
          <Button
            type="text"
            className="flex! h-11! items-center! gap-2! rounded-xl! px-1.5! text-left hover:bg-slate-100! sm:px-2!"
            aria-label="Ouvrir le menu du profil"
          >
            <Avatar
              name={user.fullName}
              src={user.photoUrl}
              size={34}
              override={{ bg: '#F5C400', text: '#0F4A0F' }}
              className="shrink-0"
            />
            <span className="hidden min-w-0 md:block">
              <span className="block max-w-32 truncate text-xs font-semibold leading-tight text-slate-800">{user.firstName}</span>
              <span className="mt-0.5 block max-w-32 truncate text-[10px] leading-tight text-slate-400">{ROLE_LABELS[user.role] ?? user.role}</span>
            </span>
            <ChevronDown size={14} className="hidden shrink-0 text-slate-400 md:block" />
          </Button>
        </Dropdown>
      )}
    </header>
  )
}
