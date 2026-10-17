'use client'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Undo2 } from 'lucide-react'
import api from '@/lib/api'
import { contributorName, formatAmount } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import type { Contribution } from '@/types'

/** Demande de remboursement (trésorier) : total ou partiel, visée ensuite par un administrateur ou un responsable. */
export function RefundRequestModal({ contribution, onClose }: { contribution: Contribution | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { addToast } = useAppStore()
  const [form, setForm] = useState({ montant: '', moyen: 'ESPECES', motif: '', beneficiaire: '' })
  const [error, setError] = useState('')
  const [lastId, setLastId] = useState<string | null>(null)
  // Formulaire réinitialisé à l'ouverture pour une autre contribution
  if (contribution && contribution.id !== lastId) {
    setLastId(contribution.id)
    setForm({ montant: String(contribution.montant), moyen: 'ESPECES', motif: '', beneficiaire: contributorName(contribution) })
    setError('')
  }

  const request = useMutation({
    mutationFn: () => api.post('/refunds', {
      contributionId: contribution!.id, montant: Number(form.montant), moyen: form.moyen,
      motif: form.motif.trim(), ...(form.beneficiaire.trim() ? { beneficiaire: form.beneficiaire.trim() } : {}),
    }),
    onSuccess: () => {
      addToast({ title: 'Demande envoyée', message: 'Un administrateur ou un responsable doit la viser.', variant: 'success' })
      void queryClient.invalidateQueries({ queryKey: ['refunds'] })
      onClose()
    },
    onError: (err: unknown) => setError((err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? 'Demande impossible'),
  })

  const montant = Number(form.montant)
  const valid = contribution && Number.isInteger(montant) && montant > 0 && montant <= contribution.montant && form.motif.trim().length >= 10
  return (
    <Modal open={!!contribution} onClose={onClose} size="sm" title="Demander un remboursement"
      description={contribution ? `${contributorName(contribution)} — contribution de ${formatAmount(contribution.montant)}. La contribution reste inchangée ; le remboursement est une écriture distincte.` : ''}>
      <div className="space-y-3">
        <label className="block text-xs font-semibold text-gray-600">
          Montant à rendre (FCFA)
          <input type="number" inputMode="numeric" min={1} max={contribution?.montant} value={form.montant} onChange={e => setForm({ ...form, montant: e.target.value })}
            className="mt-1 block min-h-11 w-full rounded-[10px] border border-gray-200 px-3 text-base" />
        </label>
        <label className="block text-xs font-semibold text-gray-600">
          Moyen
          <select value={form.moyen} onChange={e => setForm({ ...form, moyen: e.target.value })}
            className="mt-1 block min-h-11 w-full rounded-[10px] border border-gray-200 px-3 text-base">
            <option value="ESPECES">Espèces</option>
            <option value="MOBILE_MONEY">Mobile Money</option>
            <option value="VIREMENT">Virement</option>
          </select>
        </label>
        <label className="block text-xs font-semibold text-gray-600">
          Bénéficiaire (nom, numéro)
          <input value={form.beneficiaire} onChange={e => setForm({ ...form, beneficiaire: e.target.value })} maxLength={120}
            className="mt-1 block min-h-11 w-full rounded-[10px] border border-gray-200 px-3 text-base" />
        </label>
        <label className="block text-xs font-semibold text-gray-600">
          Motif <span className="text-red-500">*</span>
          <textarea value={form.motif} onChange={e => setForm({ ...form, motif: e.target.value })} rows={3} maxLength={500}
            placeholder="Ex. : trop-perçu, double paiement, collecte annulée"
            className="mt-1 w-full rounded-[10px] border border-gray-200 px-3 py-2 text-base" />
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button loading={request.isPending} disabled={!valid} onClick={() => request.mutate()}><Undo2 size={14} /> Demander</Button>
        </div>
      </div>
    </Modal>
  )
}
