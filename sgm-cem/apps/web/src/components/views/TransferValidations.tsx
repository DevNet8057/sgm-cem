'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App as AntApp, Card, Skeleton } from 'antd'
import { CheckCircle, Clock, XCircle } from 'lucide-react'
import api from '@/lib/api'
import { formatAmount, formatDateTime, TRANSFER_TYPE_EMOJI, TRANSFER_TYPE_LABELS } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import type { FundsTransfer } from '@/types'

export function TransferValidations() {
  const queryClient = useQueryClient()
  const { message } = AntApp.useApp()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [refuseModal, setRefuseModal] = useState({ open: false, transferId: null as string | null, reason: '' })

  const {
    data,
    error: queryError,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = useQuery<FundsTransfer[]>({
    queryKey: ['pending-my-approval'],
    queryFn: () => api.get('/funds/transfers/pending-my-approval').then(r => r.data.data),
    refetchInterval: 30000,
  })

  const confirmMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/funds/transfers/${id}/confirm`),
    onSuccess: async (_res, id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pending-my-approval'] }),
        queryClient.invalidateQueries({ queryKey: ['collecteurs'] }),
      ])
      message.success('Transfert confirmé')

      try {
        const response = await api.get(`/funds/transfers/${id}/borderau`, {
          responseType: 'blob',
        })
        const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `Bordereau-remise-${id.slice(0, 8).toUpperCase()}.pdf`
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      } catch {
        message.warning(
          "Le transfert est confirmé, mais le bordereau n'a pas pu être téléchargé."
        )
      }
    },
    onError: (error: unknown) => message.error(getApiErrorMessage(error, 'Confirmation impossible')),
  })

  const refuseMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.patch(`/funds/transfers/${id}/refuse`, { reason }),
    onSuccess: async () => {
      setRefuseModal({ open: false, transferId: null, reason: '' })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pending-my-approval'] }),
        queryClient.invalidateQueries({ queryKey: ['collecteurs'] }),
      ])
      message.success('Transfert refusé')
    },
    onError: (error: unknown) => message.error(getApiErrorMessage(error, 'Refus impossible')),
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
        <div className="space-y-4">
          {[1, 2].map(i => (
            <Card key={i} data-premium-card>
              <Skeleton active paragraph={{ rows: 2 }} title={{ width: '60%' }} />
            </Card>
          ))}
        </div>
      ) : isError ? (
        <Alert
          type="error"
          showIcon
          message="Impossible de charger les transferts"
          description={getApiErrorMessage(queryError, 'Le service est momentanément indisponible.')}
          action={
            <Button
              size="sm"
              variant="outline"
              loading={isFetching}
              onClick={() => void refetch()}
            >
              Réessayer
            </Button>
          }
        />
      ) : transfers.length === 0 ? (
        <EmptyState icon={CheckCircle} title="Aucune validation en attente" description="Tous les transferts ont été traités" />
      ) : (
        <div className="space-y-4">{transfers.map(t => <TransferCard key={t.id} transfer={t} expanded={expandedId === t.id} onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)} onConfirm={() => { confirmMutation.reset(); confirmMutation.mutate(t.id) }} onRefuse={() => { refuseMutation.reset(); setRefuseModal({ open: true, transferId: t.id, reason: '' }) }} confirming={confirmMutation.isPending && confirmMutation.variables === t.id} />)}</div>
      )}

      <Modal
        open={refuseModal.open}
        onClose={() => setRefuseModal({ open: false, transferId: null, reason: '' })}
        title="Refuser le transfert"
        description="Indiquez un motif précis afin que l'émetteur puisse corriger la remise."
        size="sm"
      >
        <div className="space-y-5">
          <Textarea
            autoFocus
            label="Motif du refus"
            value={refuseModal.reason}
            onChange={e => setRefuseModal(current => ({ ...current, reason: e.target.value }))}
            placeholder="Décrivez le motif du refus…"
            rows={4}
            hint={`${refuseModal.reason.trim().length} / 10 caractères minimum`}
          />
          <div className="flex flex-col-reverse gap-2 border-t border-white/10 pt-4 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              type="button"
              onClick={() => setRefuseModal({ open: false, transferId: null, reason: '' })}
              className="w-full sm:w-auto"
            >
              Annuler
            </Button>
            <Button
              variant="danger"
              type="button"
              loading={refuseMutation.isPending}
              onClick={() => refuseMutation.mutate({
                id: refuseModal.transferId!,
                reason: refuseModal.reason.trim(),
              })}
              disabled={!refuseModal.transferId || refuseModal.reason.trim().length < 10}
              className="w-full sm:w-auto"
            >
              Confirmer le refus
            </Button>
          </div>
        </div>
      </Modal>
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
    <Card data-premium-card className="border-amber-400/25">
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

      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={onToggle}
        className="mb-3 !h-auto !px-0 !text-xs"
      >
        {expanded ? 'Masquer' : 'Voir'} le détail
      </Button>

      {expanded && (
        <div className="border border-gray-100 rounded-[12px] divide-y mb-3 max-h-40 overflow-y-auto">{transfer.contributions.map(c => (
          <div key={c.id} className="flex justify-between px-3 py-2 text-xs"><span>{c.membre?.user.fullName ?? '—'}</span><span className="font-mono">{formatAmount(c.montant)}</span></div>
        ))}</div>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          type="button"
          onClick={onRefuse}
          disabled={confirming}
          className="flex-1 !border-red-400/30 !text-red-400 enabled:hover:!border-red-400/60 enabled:hover:!bg-red-400/10"
        >
          <XCircle size={16} />
          Refuser
        </Button>
        <Button
          type="button"
          onClick={onConfirm}
          loading={confirming}
          className="flex-1"
        >
          {!confirming && <CheckCircle size={16} />}
          Confirmer
        </Button>
      </div>
    </Card>
  )
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  const candidate = error as {
    response?: { data?: { error?: { message?: string } } }
    message?: string
  }
  return candidate.response?.data?.error?.message ?? candidate.message ?? fallback
}
