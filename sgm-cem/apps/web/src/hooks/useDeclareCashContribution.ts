'use client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/store/appStore'
import api from '@/lib/api'

export interface DeclareCashPayload {
  rubriqueId: string
  collecteurId: string
  montant: number
  note?: string
  periodeLabel?: string
}

// Mutation partagée POST /contributions/declare — consommée par DeclareCashForm
// (MesContributions.tsx) ET par PaymentStepper (Contribution Guidée, mode ESPECES
// verrouillé sur un membre). Chaque appelant garde son propre onSuccess/onError
// via les callbacks passés à .mutate(payload, { onSuccess, onError }) — TanStack
// Query les exécute EN PLUS de ceux définis ici (pas à leur place).
export function useDeclareCashContribution() {
  const queryClient = useQueryClient()
  const { addToast } = useAppStore()

  return useMutation({
    mutationFn: (payload: DeclareCashPayload) =>
      api.post('/contributions/declare', {
        rubriqueId: payload.rubriqueId,
        collecteurId: payload.collecteurId,
        montant: payload.montant,
        note: payload.note || undefined,
        periodeLabel: payload.periodeLabel || undefined,
      }),
    onSuccess: async () => {
      addToast({
        title: 'Déclaration envoyée',
        message: 'Le collecteur doit maintenant confirmer avoir reçu ce paiement.',
        variant: 'success',
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mes-contributions'] }),
        queryClient.invalidateQueries({ queryKey: ['mes-soldes'] }),
        queryClient.invalidateQueries({ queryKey: ['mes-contributions-confirmees'] }),
        queryClient.invalidateQueries({ queryKey: ['rubriques-ouvertes'] }),
        queryClient.invalidateQueries({ queryKey: ['rubriques'] }),
      ])
    },
  })
}

export function extractDeclareErrorMessage(err: unknown): string {
  const e = err as { response?: { data?: { error?: { message?: string } } } }
  return e.response?.data?.error?.message ?? 'Déclaration impossible'
}
