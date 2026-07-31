'use client'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Modal } from 'antd'
import api from '@/lib/api'
import { PaymentStepper } from './PaymentStepper'
import type { Membre, Rubrique } from '@/types'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

// Wrapper pur data-fetching : aucune logique de paiement ici. Charge le membre
// connecté et les rubriques ouvertes AVANT de monter PaymentStepper avec
// lockedMembreId (sinon membres=[] casserait selectedMembre côté stepper).
export function ContributionGuideeStepper({ onClose, onSuccess }: Props) {
  const { data: membre, isLoading: loadingMembre, isError: errorMembre } = useQuery<Membre>({
    queryKey: ['membre-me'],
    queryFn: async () => (await api.get('/membres/me')).data.data,
  })

  const { data: rubriques, isLoading: loadingRubriques } = useQuery<Rubrique[]>({
    queryKey: ['rubriques-ouvertes'],
    queryFn: async () => (await api.get('/rubriques', { params: { status: 'OUVERTE' } })).data.data,
  })

  if (loadingMembre || loadingRubriques) {
    return (
      <Modal open footer={null} closable={false} centered width={320} styles={{ content: { textAlign: 'center', padding: 32 } }}>
        <Loader2 size={28} className="mx-auto animate-spin text-[#1A6B1A]" />
        <p className="mt-3 text-sm text-gray-500">Préparation de votre contribution…</p>
      </Modal>
    )
  }

  if (errorMembre || !membre) {
    return (
      <Modal open onCancel={onClose} footer={null} centered width={360}>
        <p className="text-sm text-red-600 py-4 text-center">
          Impossible de charger votre profil membre. Réessayez plus tard.
        </p>
      </Modal>
    )
  }

  return (
    <PaymentStepper
      selfService
      membres={[membre]}
      rubriques={rubriques ?? []}
      onClose={onClose}
    />
  )
}
