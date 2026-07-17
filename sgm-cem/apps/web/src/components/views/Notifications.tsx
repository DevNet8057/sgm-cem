'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, Check, CheckCheck, Megaphone } from 'lucide-react'
import api from '@/lib/api'
import { cn, timeAgo } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import type { ApiResponse, Notification } from '@/types'

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  INFO:          { label: 'Information', color: 'bg-blue-100 text-blue-700' },
  CONTRIBUTION:  { label: 'Contribution', color: 'bg-green-100 text-[#1A6B1A]' },
  VALIDATION:    { label: 'Validation', color: 'bg-yellow-100 text-yellow-800' },
  LITIGE:        { label: 'Litige', color: 'bg-red-100 text-red-700' },
  SYSTEM:        { label: 'Système', color: 'bg-gray-100 text-gray-600' },
}

export function Notifications() {
  const queryClient = useQueryClient()
  const { setNotifications, markRead, markAllRead } = useAppStore()

  const { data = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Notification[]>>('/notifications')
      const notifications = res.data.data ?? []
      setNotifications(notifications)
      return notifications
    },
  })

  const unreadCount = data.filter(n => !n.isRead).length

  const readOne = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/notifications/${id}/read`)
      return id
    },
    onSuccess: (id) => {
      markRead(id)
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const readAll = useMutation({
    mutationFn: async () => api.patch('/notifications/read-all'),
    onSuccess: () => {
      markAllRead()
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      {/* Header */}
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#1A6B1A]" />
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#1A6B1A]">Centre d&apos;alertes</p>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Notifications</h2>
            <p className="text-gray-500 text-sm mt-0.5">
              {unreadCount > 0
                ? `${unreadCount} notification(s) non lue(s)`
                : 'Tout est à jour — aucune notification non lue'}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => readAll.mutate()}
            loading={readAll.isPending}
            disabled={unreadCount === 0}
          >
            <CheckCheck size={16} />
            Tout marquer lu
          </Button>
        </div>
      </div>

      {/* KPI rapide */}
      {data.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <KpiChip icon={Bell} label="Total" value={String(data.length)} color="text-gray-600 bg-gray-100" />
          <KpiChip icon={BellOff} label="Non lues" value={String(unreadCount)} color="text-[#1A6B1A] bg-[#E8F5E8]" />
          <KpiChip icon={CheckCheck} label="Lues" value={String(data.length - unreadCount)} color="text-gray-400 bg-gray-50" />
        </div>
      )}

      {isLoading ? (
        <div className="rounded-[18px] border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">
          Chargement des notifications…
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Aucune notification"
          description="Les alertes importantes apparaîtront ici."
        />
      ) : (
        <div className="overflow-hidden rounded-[18px] border border-gray-100 bg-white shadow-[0_2px_12px_rgba(15,74,15,0.06)]">
          {data.map((notification, idx) => {
            const config = TYPE_CONFIG[notification.type] ?? TYPE_CONFIG.SYSTEM
            return (
              <article
                key={notification.id}
                className={cn(
                  'flex flex-col gap-3 border-b border-gray-100 p-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between transition-colors',
                  !notification.isRead ? 'bg-[#F2FFF4]' : 'hover:bg-gray-50/60',
                  idx === 0 && 'rounded-t-[18px]'
                )}
              >
                <div className="flex gap-3">
                  <div className={cn(
                    'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]',
                    notification.isRead ? 'bg-gray-100 text-gray-400' : 'bg-[#1A6B1A] text-white'
                  )}>
                    <Megaphone size={17} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900">{notification.title}</h3>
                      <span className={cn('rounded-[6px] px-2 py-0.5 text-[11px] font-semibold', config.color)}>
                        {config.label}
                      </span>
                      {!notification.isRead && (
                        <span className="w-2 h-2 rounded-full bg-[#1A6B1A]" />
                      )}
                    </div>
                    <p className="text-sm leading-relaxed text-gray-600">{notification.body}</p>
                    <p className="mt-1.5 text-xs text-gray-400">{timeAgo(notification.createdAt)}</p>
                  </div>
                </div>

                {!notification.isRead && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => readOne.mutate(notification.id)}
                    loading={readOne.isPending}
                    className="self-start shrink-0"
                  >
                    <Check size={14} />
                    Marquer lu
                  </Button>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function KpiChip({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string; color: string
}) {
  return (
    <div className="rounded-[14px] border border-gray-100 bg-white p-3 flex items-center gap-3">
      <div className={cn('w-9 h-9 rounded-[10px] flex items-center justify-center', color)}>
        <Icon size={15} />
      </div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="font-display font-bold text-xl text-[#0F4A0F] leading-tight">{value}</p>
      </div>
    </div>
  )
}
