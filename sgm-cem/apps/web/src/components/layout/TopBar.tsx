'use client'
import { Menu, Bell, Search } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { getInitials, ROLE_LABELS } from '@/lib/utils'

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
}

export function TopBar() {
  const { setSidebarOpen, activeView, unreadCount } = useAppStore()
  const { user } = useAuthStore()

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

      <button className="relative w-9 h-9 flex items-center justify-center rounded-[10px] text-gray-600 hover:bg-gray-100 transition-colors">
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {user && (
        <div className="flex items-center gap-2 cursor-pointer group">
          <div className="w-8 h-8 rounded-[8px] bg-[#F5C400] flex items-center justify-center">
            <span className="text-[#0F4A0F] font-bold text-xs">{getInitials(user.fullName)}</span>
          </div>
          <div className="hidden md:block text-right">
            <p className="text-xs font-semibold text-gray-800 leading-tight">{user.firstName}</p>
            <p className="text-[10px] text-gray-400">{ROLE_LABELS[user.role]}</p>
          </div>
        </div>
      )}
    </header>
  )
}
