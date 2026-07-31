'use client'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/store/appStore'
import api from '@/lib/api'
import { getQueuedContributions, dequeueContribution } from '@/lib/offlineQueue'

export function useOfflineSync() {
  const [isOffline, setIsOffline] = useState(false)
  const [queuedCount, setQueuedCount] = useState(0)
  const { addToast } = useAppStore()
  const queryClient = useQueryClient()
  const registered = useRef(false)

  async function refreshQueueCount() {
    try {
      const items = await getQueuedContributions()
      setQueuedCount(items.length)
    } catch {}
  }

  async function syncQueue() {
    try {
      const items = await getQueuedContributions()
      if (items.length === 0) return

      let synced = 0
      for (const item of items) {
        try {
          const { queuedAt, ...data } = item
          await api.post('/contributions', data)
          await dequeueContribution(queuedAt)
          synced++
        } catch {}
      }

      if (synced > 0) {
        addToast({
          title: `${synced} contribution(s) synchronisée(s)`,
          message: 'Les contributions hors ligne ont été envoyées.',
          variant: 'success',
        })
        await queryClient.invalidateQueries({ queryKey: ['contributions'] })
        await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
        setQueuedCount(prev => Math.max(0, prev - synced))
      }
    } catch {}
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Register Service Worker once — production uniquement. En dev, les
    // chunks Next.js gardent la même URL d'une recompilation à l'autre ; un
    // SW cache-first y sert alors du JS obsolète pendant que le HTML SSR est
    // frais, ce qui désynchronise le hash antd (cssinjs) entre serveur et
    // client et casse l'hydratation. On nettoie aussi toute installation
    // restante d'une session précédente.
    if (!registered.current && 'serviceWorker' in navigator) {
      registered.current = true
      if (process.env.NODE_ENV === 'production') {
        navigator.serviceWorker.register('/sw.js').catch(() => {})
      } else {
        navigator.serviceWorker.getRegistrations().then(regs => {
          for (const reg of regs) reg.unregister()
        })
        if ('caches' in window) {
          caches.keys().then(keys => { for (const k of keys) caches.delete(k) })
        }
      }
    }

    setIsOffline(!navigator.onLine)
    refreshQueueCount()

    function handleOnline() {
      setIsOffline(false)
      addToast({
        title: 'Connexion rétablie',
        message: 'Synchronisation de vos données...',
        variant: 'success',
        duration: 4000,
      })
      syncQueue()
    }

    function handleOffline() {
      setIsOffline(true)
      addToast({
        title: 'Mode hors ligne',
        message: 'Les contributions seront synchronisées à la reconnexion.',
        variant: 'warning',
        duration: 8000,
      })
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { isOffline, queuedCount, syncQueue, refreshQueueCount }
}
