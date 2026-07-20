'use client'
import { Bell, CreditCard, LayoutDashboard, Users, FolderOpen } from 'lucide-react'
import { Badge } from 'antd'
import { motion, useReducedMotion } from 'framer-motion'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'

const TABS_DEFAULT = [
  { id: 'dashboard',      icon: LayoutDashboard, label: 'Accueil'   },
  { id: 'rubriques',      icon: FolderOpen,       label: 'Rubriques' },
  { id: 'contributions',  icon: CreditCard,       label: 'Paiements' },
  { id: 'notifications',  icon: Bell,             label: 'Notifs'    },
  { id: 'membres',        icon: Users,            label: 'Membres'   },
]

const TABS_COLLECTEUR = [
  { id: 'dashboard',     icon: LayoutDashboard, label: 'Accueil'   },
  { id: 'contributions', icon: CreditCard,      label: 'Paiements' },
  { id: 'collecteurs',   icon: FolderOpen,      label: 'Fonds'     },
  { id: 'notifications', icon: Bell,            label: 'Notifs'    },
]

const TABS_MEMBRE = [
  { id: 'mes-contributions', icon: CreditCard,       label: 'Mes dons'  },
  { id: 'notifications',     icon: Bell,              label: 'Notifs'    },
]

export function BottomNav() {
  const { activeView, setActiveView, unreadCount } = useAppStore()
  const { user } = useAuthStore()
  const reduceMotion = useReducedMotion()

  const tabs =
    user?.role === 'MEMBRE'     ? TABS_MEMBRE :
    user?.role === 'COLLECTEUR' ? TABS_COLLECTEUR :
    TABS_DEFAULT

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[300] border-t border-slate-200/80 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl lg:hidden"
      aria-label="Navigation mobile principale"
    >
      <div
        className="mx-auto grid h-16 max-w-lg items-stretch"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map(tab => {
          const active = activeView === tab.id
          const Icon = tab.icon
          const count = tab.id === 'notifications' ? unreadCount : 0

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveView(tab.id)}
              className={cn(
                'relative flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A6B1A] focus-visible:ring-offset-2',
                active ? 'text-[#0F5718]' : 'text-slate-500 hover:text-slate-700'
              )}
              aria-label={`${tab.label}${count > 0 ? `, ${count} notification${count > 1 ? 's' : ''} non lue${count > 1 ? 's' : ''}` : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <Badge
                count={count > 9 ? '9+' : count}
                overflowCount={9}
                size="small"
                styles={{ indicator: { backgroundColor: '#ef4444', boxShadow: '0 0 0 2px #fff', fontSize: 9, fontWeight: 700 } }}
                className="relative z-10 leading-none"
              >
                <motion.span
                  animate={reduceMotion ? undefined : { y: active ? -1 : 0, scale: active ? 1.05 : 1 }}
                  transition={{ duration: 0.18 }}
                  className="relative flex h-8 w-10 items-center justify-center"
                  aria-hidden="true"
                >
                  {active && (
                    <motion.span
                      layoutId="bottom-nav-active"
                      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                      className="absolute inset-0 rounded-xl bg-[#EAF6EC]"
                    />
                  )}
                  <Icon className="relative z-10" size={19} strokeWidth={active ? 2.4 : 2} />
                </motion.span>
              </Badge>
              <span className="relative z-10 block w-full min-w-0 truncate text-center leading-none">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
