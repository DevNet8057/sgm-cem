import { useEffect } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// Période consultée (tableau de bord, statistiques) : partagée entre les écrans
// et conservée pour l'onglet (sessionStorage) afin qu'un retour dans l'historique
// ne soit pas perdu en changeant de vue ou en rechargeant la page.
// month = null : année entière.
export interface Period {
  year: number
  month: number | null
}

interface PeriodState {
  period: Period
  setPeriod: (period: Period) => void
}

const now = new Date()

export const usePeriodStore = create<PeriodState>()(persist(
  set => ({
    period: { year: now.getFullYear(), month: now.getMonth() + 1 },
    setPeriod: period => set({ period }),
  }),
  {
    name: 'sgm-periode',
    storage: createJSONStorage(() => sessionStorage),
    partialize: state => ({ period: state.period }),
    // Relue après le premier rendu (évite un écart entre rendu serveur et client)
    skipHydration: true,
  },
))

/** Période partagée, relue depuis l'onglet au montage. */
export function useSharedPeriod() {
  const period = usePeriodStore(s => s.period)
  const setPeriod = usePeriodStore(s => s.setPeriod)
  useEffect(() => {
    try { void usePeriodStore.persist.rehydrate() } catch { /* stockage indisponible : période par défaut */ }
  }, [])
  return { period, setPeriod }
}
