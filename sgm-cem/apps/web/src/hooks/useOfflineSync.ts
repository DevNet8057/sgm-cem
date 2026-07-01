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

    // Register Service Worker once
    if (!registered.current && 'serviceWorker' in navigator) {
      registered.current = true
      navigator.serviceWorker.register('/sw.js').catch(() => {})
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
