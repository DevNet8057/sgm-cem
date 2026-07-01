'use client'
import { useRef } from 'react'
import { Menu, Bell, Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { getInitials, ROLE_LABELS } from '@/lib/utils'
import type { ApiResponse, Notification } from '@/types'

const VIEW_TITLES: Record<string, string> = {
  dashboard: 'Tableau de Bord',
  rubriques: 'Rubriques',
  contributions: 'Contributions',
  collecteurs: 'Fonds Collecteurs',
  validations: 'Validations en attente',
  membres: 'Gestion des Membres',
  ged: 'GED Commissions',
  prestations: 'Prestations de Génie',
  litiges: 'Gestion des Litiges',
  statistiques: 'Statistiques & Analyses',
  rapports: 'Rapports',
  notifications: 'Notifications',
  parametres: 'Paramètres Système',
  'mon-profil': 'Mon Profil',
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
      // 'bip' (default)
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
  const { user } = useAuthStore()
  const seenIds = useRef<Set<string>>(new Set())
  const firstLoad = useRef(true)

  useQuery({
    queryKey: ['notifications'],
    enabled: Boolean(user),
    queryFn: async () => {
      const res = await api.get<ApiResponse<Notification[]>>('/notifications')
      const notifications = res.data.data ?? []
      setNotifications(notifications)

      // Detect new unread notifications since last poll
      const newOnes = notifications.filter(n => !n.isRead && !seenIds.current.has(n.id))
      if (newOnes.length > 0 && !firstLoad.current) {
        newOnes.forEach(n => {
          addToast({ title: n.title, message: n.body, variant: 'info', duration: 5000 })
        })
        playNotifSound()
      }

      // Update seen set
      notifications.forEach(n => seenIds.current.add(n.id))
      firstLoad.current = false

      return notifications
    },
    refetchInterval: 30000,
  })

  return (
    <header
      className="sticky top-0 z-[200] h-16 bg-white/90 backdrop-blur-md border-b border-gray-100/80 flex items-center px-4 gap-3"
      style={{ height: 'var(--topbar-h)' }}
    >
      <button
        onClick={() => setSidebarOpen(true)}
        className="lg:hidden w-9 h-9 flex items-center justify-center rounded-[10px] text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <Menu size={20} />
      </button>

      <div className="flex-1">
        <h1 className="font-display font-semibold text-[#0F4A0F] text-lg leading-tight">
          {VIEW_TITLES[activeView] ?? 'SGM-CEM'}
        </h1>
      </div>

      <div className="hidden md:flex items-center gap-1.5 px-3 py-2 bg-gray-100 rounded-[10px] text-gray-400 text-sm w-52 cursor-pointer hover:bg-gray-200 transition-colors">
        <Search size={14} />
        <span className="text-xs">Rechercher...</span>
        <span className="ml-auto text-[10px] bg-gray-200 px-1.5 py-0.5 rounded text-gray-500">⌘K</span>
      </div>

      <button
        onClick={() => setActiveView('notifications')}
        className="relative w-9 h-9 flex items-center justify-center rounded-[10px] text-gray-600 hover:bg-gray-100 transition-colors"
        title="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {user && (
        <button
          onClick={() => setActiveView('mon-profil')}
          className="flex items-center gap-2 cursor-pointer group hover:opacity-80 transition-opacity"
          title="Mon profil"
        >
          <div className="w-8 h-8 rounded-[8px] bg-[#F5C400] flex items-center justify-center overflow-hidden flex-shrink-0">
            {user.photoUrl ? (
              <img src={user.photoUrl} alt={user.firstName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-[#0F4A0F] font-bold text-xs">{getInitials(user.fullName)}</span>
            )}
          </div>
          <div className="hidden md:block text-right">
            <p className="text-xs font-semibold text-gray-800 leading-tight">{user.firstName}</p>
            <p className="text-[10px] text-gray-400">{ROLE_LABELS[user.role]}</p>
          </div>
        </button>
      )}
    </header>
  )
}
