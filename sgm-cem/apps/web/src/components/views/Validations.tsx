'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock, CreditCard, MessageSquare, Paperclip } from 'lucide-react'
import api from '@/lib/api'
import { formatAmount, formatDateTime, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import type { Contribution } from '@/types'

export function Validations() {
  const queryClient = useQueryClient()
  const [disputeId, setDisputeId] = useState<string | null>(null)
  const [motif, setMotif] = useState('')
  const [motifError, setMotifError] = useState('')

  const { data, isLoading } = useQuery<Contribution[]>({
    queryKey: ['validations'],
    queryFn: async () => (await api.get('/contributions/validations')).data.data,
    refetchInterval: 30000,
  })

  const confirm = useMutation({
    mutationFn: async (id: string) => api.patch(`/contributions/${id}/confirm`),
    onSuccess: refreshCore,
  })

  const dispute = useMutation({
    mutationFn: async ({ id, motif }: { id: string; motif: string }) =>
      api.patch(`/contributions/${id}/litige`, { motif }),
    onSuccess: () => {
      setDisputeId(null)
      setMotif('')
      setMotifError('')
      refreshCore()
    },
  })

  async function refreshCore() {
    await queryClient.invalidateQueries({ queryKey: ['validations'] })
    await queryClient.invalidateQueries({ queryKey: ['contributions'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    await queryClient.invalidateQueries({ queryKey: ['monthly-stats'] })
    await queryClient.invalidateQueries({ queryKey: ['rubriques'] })
  }

  function openDisputeModal(id: string) {
    setDisputeId(id)
    setMotif('')
    setMotifError('')
  }

  function submitDispute() {
    if (motif.trim().length < 10) {
      setMotifError('Le motif doit faire au moins 10 caractères')
      return
    }
    if (disputeId) dispute.mutate({ id: disputeId, motif: motif.trim() })
  }

  const validations = data ?? []
  const total = validations.reduce((sum, c) => sum + c.montant, 0)

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      {/* Header */}
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-yellow-400" />
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-yellow-600">File d&apos;attente</p>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Validations</h2>
            <p className="text-gray-500 text-sm mt-0.5">{validations.length} paiement(s) en attente de confirmation</p>
          </div>
          {total > 0 && (
            <div className="flex items-center gap-2 rounded-[14px] bg-yellow-50 border border-yellow-200 px-4 py-3">
              <Clock size={16} className="text-yellow-600" />
              <div>
                <p className="text-xs text-yellow-700 font-medium">Montant en attente</p>
                <p className="font-mono font-bold text-yellow-800">{formatAmount(total)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden shadow-[0_2px_12px_rgba(15,74,15,0.06)]">
        <div className="px-5 py-4 flex items-center justify-between"
          style={{ background: 'linear-gradient(135deg, #0F4A0F, #1A6B1A)' }}>
          <h3 className="font-display font-semibold text-white text-sm">Paiements à vérifier</h3>
          <span className="text-white/60 text-xs bg-white/10 px-2.5 py-1 rounded-full">Confirmation manuelle</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm table-mobile-cards">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                {['Membre', 'Rubrique', 'Montant', 'Mode', 'Collecteur', 'Date', 'Action'].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonTableRow key={i} cols={7} />)
              ) : validations.length === 0 ? (
                <tr><td colSpan={7}>
                  <EmptyState
                    icon={CheckCircle2}
                    title="Tout est validé"
                    description="Aucun paiement en attente de confirmation pour le moment."
                  />
                </td></tr>
              ) : (
                validations.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-[#1A6B1A]/4 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={c.membre?.user.fullName ?? '—'} size="sm" />
                        <p className="font-medium text-gray-800">{c.membre?.user.fullName ?? '-'}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600" data-label="Rubrique">
                      <p className="font-mono font-semibold">{c.rubrique?.code}</p>
                      <p className="text-gray-400 truncate max-w-[180px]">{c.rubrique?.title}</p>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-[#1A6B1A]" data-label="Montant">{formatAmount(c.montant)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500" data-label="Mode">{MODE_PAIEMENT_LABELS[c.modePaiement]}</td>
                    <td className="px-4 py-3 text-xs text-gray-500" data-label="Collecteur">{c.collecteur?.fullName ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400" data-label="Date">{formatDateTime(c.createdAt)}</td>
                    <td className="px-4 py-3" data-label="Actions">
                      <div className="flex flex-wrap gap-2">
                        {c.proofUrl && (
                          <a
                            href={c.proofUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Voir la preuve de paiement"
                            className="flex items-center gap-1 px-2 py-1.5 rounded-[8px] text-xs font-semibold border text-green-600 border-green-200 hover:bg-green-50 transition-colors"
                          >
                            <Paperclip size={11} />
                            Preuve
                          </a>
                        )}
                        <Button
                          size="sm"
                          loading={confirm.isPending}
                          onClick={() => confirm.mutate(c.id)}
                        >
                          <CheckCircle2 size={13} />
                          Confirmer
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => openDisputeModal(c.id)}
                        >
                          <AlertTriangle size={13} />
                          Litige
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal litige */}
      <Modal
        open={disputeId !== null}
        onClose={() => { setDisputeId(null); setMotif(''); setMotifError('') }}
        title="Signaler un litige"
        description="Décrivez le problème constaté sur ce paiement."
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">
              Motif du litige <span className="text-red-500">*</span>
            </label>
            <textarea
              value={motif}
              onChange={e => { setMotif(e.target.value); setMotifError('') }}
              rows={4}
              placeholder="Décrivez le problème : montant incorrect, mode de paiement non reçu, membre inconnu…"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 resize-none transition-colors"
            />
            {motifError && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                <AlertTriangle size={11} /> {motifError}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-1">{motif.length} / 10 caractères minimum</p>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button
              variant="ghost"
              onClick={() => { setDisputeId(null); setMotif(''); setMotifError('') }}
            >
              Annuler
            </Button>
            <Button
              variant="danger"
              loading={dispute.isPending}
              onClick={submitDispute}
            >
              <MessageSquare size={14} />
              Confirmer le litige
            </Button>
          </div>
        </div>
      </Modal>

      {/* KPI footer */}
      {validations.length > 0 && (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: CreditCard, label: 'En attente', value: String(validations.length), color: 'bg-yellow-50 text-yellow-700' },
            { icon: Clock, label: 'Montant total', value: formatAmount(total), color: 'bg-green-50 text-[#1A6B1A]' },
          ].map(item => (
            <div key={item.label} className={`rounded-[14px] border border-gray-100 bg-white p-3 flex items-center gap-3`}>
              <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center ${item.color}`}>
                <item.icon size={16} />
              </div>
              <div>
                <p className="text-xs text-gray-500">{item.label}</p>
                <p className="font-mono font-bold text-sm text-gray-800">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
