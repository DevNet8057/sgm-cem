'use client'
import { Badge, Button } from 'antd'
import { motion, useReducedMotion } from 'framer-motion'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'
import { getMobileNavigationForRole } from '@/config/navigation'

export function BottomNav() {
  const { activeView, setActiveView, unreadCount } = useAppStore()
  const { user } = useAuthStore()
  const reduceMotion = useReducedMotion()

  const tabs = user ? getMobileNavigationForRole(user.role) : []

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[300] border-t border-dash-border bg-dash-sidebar/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(0,0,0,0.25)] backdrop-blur-xl lg:hidden"
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
            <Button
              key={tab.id}
              type="text"
              htmlType="button"
              onClick={() => setActiveView(tab.id)}
              className={cn(
                'relative! flex! h-16! min-h-11! min-w-0! flex-col! items-center! justify-center! gap-1! rounded-xl! border-0! px-1! py-2! text-[10px]! font-semibold! shadow-none! transition-colors! focus-visible:outline-none! focus-visible:ring-2! focus-visible:ring-dash-primary! focus-visible:ring-offset-2! focus-visible:ring-offset-dash-sidebar!',
                active
                  ? 'bg-dash-primary/[.06]! text-dash-text!'
                  : 'bg-transparent! text-dash-textMuted! hover:bg-dash-cardHover/40! hover:text-dash-text!'
              )}
              aria-label={`${tab.shortLabel}${count > 0 ? `, ${count} notification${count > 1 ? 's' : ''} non lue${count > 1 ? 's' : ''}` : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <Badge
                count={count > 9 ? '9+' : count}
                overflowCount={9}
                size="small"
                styles={{ indicator: { backgroundColor: '#EF4444', boxShadow: '0 0 0 2px var(--dash-sidebar)', fontSize: 9, fontWeight: 700 } }}
                className="relative z-10 leading-none"
              >
                <motion.span
                  animate={reduceMotion ? undefined : { y: active ? -1 : 0, scale: active ? 1.05 : 1 }}
                  transition={{ duration: reduceMotion ? 0 : 0.18 }}
                  className="relative flex h-8 w-10 items-center justify-center"
                  aria-hidden="true"
                >
                  {active && (
                    <motion.span
                      layoutId="bottom-nav-active"
                      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                      className="absolute inset-0 rounded-xl bg-dash-primary/15"
                    />
                  )}
                  <Icon className="relative z-10" size={19} strokeWidth={active ? 2.4 : 2} />
                </motion.span>
              </Badge>
              <span className="relative z-10 block w-full min-w-0 truncate text-center leading-none">
                {tab.shortLabel}
              </span>
            </Button>
          )
        })}
      </div>
    </nav>
  )
}
