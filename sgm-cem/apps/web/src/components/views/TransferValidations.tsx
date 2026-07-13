'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Clock, XCircle, Loader2, ChevronDown } from 'lucide-react'
import api from '@/lib/api'
import { formatAmount, formatDateTime, TRANSFER_TYPE_EMOJI, TRANSFER_TYPE_LABELS } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import type { FundsTransfer } from '@/types'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api'

export function TransferValidations() {
  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [refuseModal, setRefuseModal] = useState({ open: false, transferId: null as string | null, reason: '' })

  const { data, isLoading } = useQuery<FundsTransfer[]>({
    queryKey: ['pending-my-approval'],
    queryFn: () => api.get('/funds/transfers/pending-my-approval').then(r => r.data.data),
    refetchInterval: 30000,
  })

  const confirmMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/funds/transfers/${id}/confirm`),
    onSuccess: (_res, id) => {
      queryClient.invalidateQueries({ queryKey: ['pending-my-approval', 'collecteurs'] })
      // Le bordereau de remise vient d'être généré — on l'ouvre immédiatement.
      window.open(`${API_URL}/funds/transfers/${id}/borderau`, '_blank')
    },
  })

  const refuseMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.patch(`/funds/transfers/${id}/refuse`, { reason }),
    onSuccess: () => {
      setRefuseModal({ open: false, transferId: null, reason: '' })
      queryClient.invalidateQueries({ queryKey: ['pending-my-approval', 'collecteurs'] })
    },
  })

  const transfers = data ?? []

  return (
    <div className="p-4 lg:p-6 pb-safe space-y-6 animate-page-enter">
      <div>
        <h1 className="font-display text-2xl font-semibold text-gray-900">Fonds à réceptionner</h1>
        <p className="text-gray-500 text-sm mt-1">Transferts de fonds qui vous sont adressés et nécessitent votre confirmation</p>
      </div>

      {transfers.length > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-[16px] p-4">
          <Clock size={20} className="text-amber-600" />
          <p className="font-semibold text-amber-900 text-sm">{transfers.length} transfert{transfers.length > 1 ? 's' : ''} en attente</p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">{[1, 2].map(i => <div key={i} className="bg-white rounded-[18px] p-5 animate-pulse"><div className="h-4 bg-gray-200 rounded w-3/4 mb-3"></div></div>)}</div>
      ) : transfers.length === 0 ? (
        <EmptyState icon={CheckCircle} title="Aucune validation en attente" description="Tous les transferts ont été traités" />
      ) : (
        <div className="space-y-4">{transfers.map(t => <TransferCard key={t.id} transfer={t} expanded={expandedId === t.id} onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)} onConfirm={() => confirmMutation.mutate(t.id)} onRefuse={() => setRefuseModal({ open: true, transferId: t.id, reason: '' })} confirming={confirmMutation.isPending} />)}</div>
      )}

      {refuseModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-[20px] max-w-sm w-full p-5">
            <h3 className="font-semibold text-red-900 mb-4">Refuser le transfert</h3>
            <textarea value={refuseModal.reason} onChange={e => setRefuseModal({ ...refuseModal, reason: e.target.value })} placeholder="Motif du refus..." rows={3} className="w-full p-2 border rounded mb-4" />
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setRefuseModal({ ...refuseModal, open: false })} className="flex-1">Annuler</Button>
              <Button variant="danger" onClick={() => refuseMutation.mutate({ id: refuseModal.transferId!, reason: refuseModal.reason })} disabled={refuseModal.reason.trim().length < 10} className="flex-1">Confirmer</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TransferCard({ transfer, expanded, onToggle, onConfirm, onRefuse, confirming }: {
  transfer: FundsTransfer
  expanded: boolean
  onToggle: () => void
  onConfirm: () => void
  onRefuse: () => void
  confirming: boolean
}) {
  return (
    <div className="bg-white rounded-[18px] border-2 border-amber-200 p-4">
      <div className="flex justify-between items-center mb-3">
        <div>
          <p className="font-semibold text-gray-900 text-sm">{transfer.senderName}</p>
          <p className="text-xs text-gray-500">{formatDateTime(typeof transfer.createdAt === 'string' ? transfer.createdAt : transfer.createdAt)}</p>
        </div>
        <p className="font-display font-bold text-xl text-[#1A6B1A]">{formatAmount(transfer.totalAmount)}</p>
      </div>

      <div className="flex items-center gap-2 text-sm text-gray-600 mb-3">
        <span>{TRANSFER_TYPE_EMOJI[transfer.transferType] ?? '📦'}</span>
        <span>{TRANSFER_TYPE_LABELS[transfer.transferType]}</span>
      </div>

      {transfer.senderNote && (
        <div className="bg-gray-50 rounded-[10px] p-3 mb-3">
          <p className="text-xs italic">{transfer.senderNote}</p>
        </div>
      )}

      <button onClick={onToggle} className="text-xs text-[#1A6B1A] mb-3">{expanded ? 'Masquer' : 'Voir'} le détail</button>

      {expanded && (
        <div className="border border-gray-100 rounded-[12px] divide-y mb-3 max-h-40 overflow-y-auto">{transfer.contributions.map(c => (
          <div key={c.id} className="flex justify-between px-3 py-2 text-xs"><span>{c.membre?.user.fullName ?? '—'}</span><span className="font-mono">{formatAmount(c.montant)}</span></div>
        ))}</div>
      )}

      <div className="flex gap-2">
        <button onClick={onRefuse} disabled={confirming} className="flex-1 py-2 text-sm font-semibold text-red-600 border-2 border-red-200 rounded-[10px] disabled:opacity-50">Refuser</button>
        <button onClick={onConfirm} disabled={confirming} className="flex-1 py-2 text-sm font-bold text-white bg-[#1A6B1A] rounded-[10px] disabled:opacity-50">{confirming ? <Loader2 className="animate-spin" /> : <CheckCircle />} Confirmer</button>
      </div>
    </div>
  )
}