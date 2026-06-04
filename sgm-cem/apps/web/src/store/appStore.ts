import { create } from 'zustand'
import type { Notification, ToastOptions } from '@/types'

interface Toast extends ToastOptions {
  id: string
}

interface AppState {
  activeView: string
  setActiveView: (v: string) => void
  sidebarOpen: boolean
  setSidebarOpen: (v: boolean) => void
  notifications: Notification[]
  setNotifications: (n: Notification[]) => void
  unreadCount: number
  markRead: (id: string) => void
  markAllRead: () => void
  toasts: Toast[]
  addToast: (options: ToastOptions) => void
  removeToast: (id: string) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  activeView: 'dashboard',
  setActiveView: (v) => set({ activeView: v }),
  sidebarOpen: false,
  setSidebarOpen: (v) => set({ sidebarOpen: v }),

  notifications: [],
  setNotifications: (notifications) => set({
    notifications,
    unreadCount: notifications.filter(n => !n.isRead).length
  }),
  unreadCount: 0,
  markRead: (id) => set(state => ({
    notifications: state.notifications.map(n => n.id === id ? { ...n, isRead: true } : n),
    unreadCount: Math.max(0, state.unreadCount - 1)
  })),
  markAllRead: () => set(state => ({
    notifications: state.notifications.map(n => ({ ...n, isRead: true })),
    unreadCount: 0
  })),

  toasts: [],
  addToast: (options) => {
    const id = Math.random().toString(36).slice(2)
    const toast: Toast = { ...options, id, variant: options.variant ?? 'info', duration: options.duration ?? 4000 }
    set(state => ({ toasts: [...state.toasts.slice(-2), toast] }))
    setTimeout(() => get().removeToast(id), toast.duration)
  },
  removeToast: (id) => set(state => ({ toasts: state.toasts.filter(t => t.id !== id) })),
}))
