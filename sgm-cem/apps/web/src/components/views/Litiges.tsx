'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, MessageSquare, Paperclip, XCircle } from 'lucide-react'
import api from '@/lib/api'
import { formatAmount, formatDateTime, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import type { Contribution } from '@/types'

type Resolution = 'CONFIRME' | 'ANNULE'

export function Litiges() {
  const queryClient = useQueryClient()
  const [resolving, setResolving] = useState<{ id: string; resolution: Resolution } | null>(null)
  const [note, setNote] = useState('')

  const { data, isLoading } = useQuery<Contribution[]>({
    queryKey: ['litiges'],
    queryFn: async () => (await api.get('/contributions/litiges')).data.data,
    refetchInterval: 30000,
  })

  const resolve = useMutation({
    mutationFn: async ({ id, resolution, note }: { id: string; resolution: Resolution; note?: string }) =>
      api.patch(`/contributions/${id}/resolve-litige`, { resolution, note }),
    onSuccess: async () => {
      setResolving(null)
      setNote('')
      await queryClient.invalidateQueries({ queryKey: ['litiges'] })
      await queryClient.invalidateQueries({ queryKey: ['contributions'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      await queryClient.invalidateQueries({ queryKey: ['collecteurs'] })
    },
  })

  function openResolve(id: string, resolution: Resolution) {
    setResolving({ id, resolution })
    setNote('')
  }

  function submitResolve() {
    if (!resolving) return
    resolve.mutate({ id: resolving.id, resolution: resolving.resolution, note: note.trim() || undefined })
  }

  const litiges = data ?? []

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      {/* Header */}
      <div className="relative overflow-hidden rounded-[18px] border border-red-200/60 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-red-500" />
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-red-600">À résoudre</p>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Litiges</h2>
            <p className="text-gray-500 text-sm mt-0.5">{litiges.length} contribution(s) contestée(s)</p>
          </div>
          {litiges.length > 0 && (
            <div className="flex items-center gap-2 rounded-[14px] bg-red-50 border border-red-200 px-4 py-3">
              <AlertTriangle size={16} className="text-red-500" />
              <div>
                <p className="text-xs text-red-700 font-medium">Montant en litige</p>
                <p className="font-mono font-bold text-red-800">
                  {formatAmount(litiges.reduce((s, c) => s + c.montant, 0))}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden shadow-[0_2px_12px_rgba(15,74,15,0.06)]">
        <div className="px-5 py-4" style={{ background: 'linear-gradient(135deg, #7F1D1D, #DC2626)' }}>
          <h3 className="font-display font-semibold text-white text-sm">Contributions contestées</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                {['Membre', 'Rubrique', 'Montant', 'Mode', 'Motif du litige', 'Date', 'Action'].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonTableRow key={i} cols={7} />)
              ) : litiges.length === 0 ? (
                <tr><td colSpan={7}>
                  <EmptyState
                    icon={AlertTriangle}
                    title="Aucun litige actif"
                    description="Les contributions contestées apparaîtront ici."
                  />
                </td></tr>
              ) : (
                litiges.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-red-50/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800">{c.membre?.user.fullName ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <p className="font-mono font-semibold">{c.rubrique?.code}</p>
                      <p className="text-gray-400 truncate max-w-[160px]">{c.rubrique?.title}</p>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-[#1A6B1A]">{formatAmount(c.montant)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{MODE_PAIEMENT_LABELS[c.modePaiement]}</td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-red-700 max-w-[200px] line-clamp-2">{c.litigeMotif ?? '-'}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{formatDateTime(c.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {c.proofUrl && (
                          <a
                            href={c.proofUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Voir la preuve de paiement jointe"
                            className="flex items-center gap-1 px-2 py-1.5 rounded-[8px] text-xs font-semibold border text-green-600 border-green-200 hover:bg-green-50 transition-colors"
                          >
                            <Paperclip size={11} />
                            Preuve
                          </a>
                        )}
                        <Button
                          size="sm"
                          onClick={() => openResolve(c.id, 'CONFIRME')}
                        >
                          <CheckCircle2 size={13} />
                          Confirmer
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => openResolve(c.id, 'ANNULE')}
                        >
                          <XCircle size={13} />
                          Annuler
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

      {/* Modal résolution */}
      <Modal
        open={resolving !== null}
        onClose={() => { setResolving(null); setNote('') }}
        title={resolving?.resolution === 'CONFIRME' ? 'Confirmer la contribution' : 'Annuler la contribution'}
        description={resolving?.resolution === 'CONFIRME'
          ? 'La contribution sera marquée comme confirmée et le litige clôturé.'
          : 'La contribution sera définitivement annulée.'}
      >
        <div className="space-y-4">
          {resolving?.resolution === 'ANNULE' && (
            <div className="flex items-start gap-2 rounded-[10px] bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              Cette action est irréversible. La contribution ne pourra plus être récupérée.
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">
              Note de résolution <span className="text-gray-400">(optionnel)</span>
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder={resolving?.resolution === 'CONFIRME'
                ? 'Ex : Paiement vérifié par le trésorier le…'
                : 'Ex : Paiement jamais reçu, confirmé par le collecteur…'}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 resize-none transition-colors"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="ghost" onClick={() => { setResolving(null); setNote('') }}>
              Annuler
            </Button>
            <Button
              variant={resolving?.resolution === 'CONFIRME' ? 'primary' : 'danger'}
              loading={resolve.isPending}
              onClick={submitResolve}
            >
              {resolving?.resolution === 'CONFIRME'
                ? <><CheckCircle2 size={14} /> Confirmer</>
                : <><XCircle size={14} /> Annuler la contribution</>}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
