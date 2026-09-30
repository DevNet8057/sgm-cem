'use client'
import { CreditCard, LayoutDashboard, Users, FolderOpen } from 'lucide-react'
import { motion } from 'framer-motion'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'

// La cloche de notifications vit uniquement dans le TopBar (haut d'écran,
// visible sur mobile ET desktop) — pas de doublon ici. Voir feedback
// utilisateur : deux boutons de notification simultanés (haut + bas) n'est
// pas normal sur mobile.
const TABS_DEFAULT = [
  { id: 'dashboard',      icon: LayoutDashboard, label: 'Accueil'   },
  { id: 'rubriques',      icon: FolderOpen,       label: 'Rubriques' },
  { id: 'contributions',  icon: CreditCard,       label: 'Paiements' },
  { id: 'membres',        icon: Users,            label: 'Membres'   },
]

const TABS_COLLECTEUR = [
  { id: 'dashboard',     icon: LayoutDashboard, label: 'Accueil'   },
  { id: 'contributions', icon: CreditCard,      label: 'Paiements' },
  { id: 'collecteurs',   icon: FolderOpen,      label: 'Fonds'     },
]

const TABS_MEMBRE = [
  { id: 'mes-contributions', icon: CreditCard,       label: 'Mes dons'  },
  { id: 'rubriques',         icon: FolderOpen,        label: 'Rubriques' },
]

export function BottomNav() {
  const { activeView, setActiveView } = useAppStore()
  const { user } = useAuthStore()

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

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveView(tab.id)}
              className={cn(
                'relative flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A6B1A] focus-visible:ring-offset-2',
                active ? 'text-[#0F5718]' : 'text-slate-500 hover:text-slate-700'
              )}
              aria-label={tab.label}
              aria-current={active ? 'page' : undefined}
            >
              <motion.span
                animate={{ y: active ? -1 : 0, scale: active ? 1.05 : 1 }}
                transition={{ duration: 0.18 }}
                className="relative flex h-8 w-10 items-center justify-center"
                aria-hidden="true"
              >
                {active && (
                  <motion.span
                    layoutId="bottom-nav-active"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-xl bg-[#EAF6EC]"
                  />
                )}
                <Icon className="relative z-10" size={19} strokeWidth={active ? 2.4 : 2} />
              </motion.span>
              <span className="relative z-10 block w-full min-w-0 truncate text-center leading-none">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
