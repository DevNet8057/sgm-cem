'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, CheckCheck, Megaphone } from 'lucide-react'
import api from '@/lib/api'
import { cn, timeAgo } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import type { ApiResponse, Notification } from '@/types'

const TYPE_LABELS: Record<string, string> = {
  INFO: 'Information',
  CONTRIBUTION: 'Contribution',
  VALIDATION: 'Validation',
  LITIGE: 'Litige',
  SYSTEM: 'Systeme',
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

  const unreadCount = data.filter(notification => !notification.isRead).length

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
    <div className="space-y-5 animate-page-enter">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold text-[#0F4A0F]">Notifications</h2>
          <p className="text-sm text-gray-500">
            {unreadCount > 0 ? `${unreadCount} notification(s) non lue(s)` : 'Tout est a jour'}
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

      {isLoading ? (
        <div className="rounded-[8px] border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">
          Chargement des notifications...
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Aucune notification"
          description="Les alertes importantes apparaitront ici."
        />
      ) : (
        <div className="overflow-hidden rounded-[8px] border border-gray-100 bg-white shadow-sm">
          {data.map(notification => (
            <article
              key={notification.id}
              className={cn(
                'flex flex-col gap-3 border-b border-gray-100 p-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between',
                !notification.isRead && 'bg-[#F2FFF4]'
              )}
            >
              <div className="flex gap-3">
                <div className={cn(
                  'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]',
                  notification.isRead ? 'bg-gray-100 text-gray-500' : 'bg-[#1A6B1A] text-white'
                )}>
                  <Megaphone size={18} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{notification.title}</h3>
                    <span className="rounded-[6px] bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
                      {TYPE_LABELS[notification.type] ?? notification.type}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-gray-600">{notification.body}</p>
                  <p className="mt-2 text-xs text-gray-400">{timeAgo(notification.createdAt)}</p>
                </div>
              </div>

              {!notification.isRead && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => readOne.mutate(notification.id)}
                  loading={readOne.isPending}
                  className="self-start"
                >
                  <Check size={14} />
                  Lu
                </Button>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
