'use client'
import { LayoutDashboard, FolderOpen, CreditCard, Bell, User } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { cn } from '@/lib/utils'

const TABS = [
  { id: 'dashboard',     icon: LayoutDashboard, label: 'Accueil' },
  { id: 'rubriques',     icon: FolderOpen,       label: 'Rubriques' },
  { id: 'contributions', icon: CreditCard,        label: 'Paiements' },
  { id: 'notifications', icon: Bell,              label: 'Notifs' },
  { id: 'membres',       icon: User,              label: 'Membres' },
]

export function BottomNav() {
  const { activeView, setActiveView, unreadCount } = useAppStore()

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-[300] bg-white border-t border-gray-100 pb-safe flex">
      {TABS.map(tab => {
        const active = activeView === tab.id
        const Icon = tab.icon
        return (
          <button
            key={tab.id}
            onClick={() => setActiveView(tab.id)}
            className={cn(
              'flex-1 flex flex-col items-center justify-center pt-2 pb-1 gap-0.5 relative transition-colors',
              active ? 'text-[#1A6B1A]' : 'text-gray-400'
            )}
          >
            {active && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[#1A6B1A] rounded-full" />
            )}
            <div className={cn('p-1.5 rounded-[8px] transition-colors', active && 'bg-[#E8F5E8]')}>
              <Icon size={18} />
            </div>
            <span className="text-[9px] font-medium">{tab.label}</span>
            {tab.id === 'notifications' && unreadCount > 0 && (
              <span className="absolute top-1.5 right-[calc(50%-14px)] w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
