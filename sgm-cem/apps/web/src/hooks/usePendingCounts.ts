'use client'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'

// Compteur des transferts de fonds qui attendent MA confirmation : badge du
// menu et de l'onglet « Réceptions ». Rafraîchi chaque minute et à chaque
// retour sur l'application ; le temps réel (Socket.IO) invalide aussi la requête.
export function usePendingCounts(): void {
  const role = useAuthStore(state => state.user?.role)
  const isStaff = !!role && role !== 'MEMBRE'
  const { data } = useQuery<{ pendingValidations: number }>({
    queryKey: ['funds-overview-badge'],
    queryFn: async () => (await api.get('/funds/overview')).data.data,
    enabled: isStaff,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
  useEffect(() => {
    useAppStore.getState().setPendingTransfersCount(isStaff ? data?.pendingValidations ?? 0 : 0)
  }, [data, isStaff])
}
