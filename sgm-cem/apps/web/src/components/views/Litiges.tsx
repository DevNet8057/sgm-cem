'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import api from '@/lib/api'
import { formatAmount, formatDateTime, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import type { Contribution } from '@/types'

export function Litiges() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery<Contribution[]>({
    queryKey: ['litiges'],
    queryFn: async () => (await api.get('/contributions/litiges')).data.data,
    refetchInterval: 30000,
  })

  const resolve = useMutation({
    mutationFn: async ({ id, resolution, note }: { id: string; resolution: 'CONFIRME' | 'ANNULE'; note?: string }) =>
      api.patch(`/contributions/${id}/resolve-litige`, { resolution, note }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['litiges'] })
      await queryClient.invalidateQueries({ queryKey: ['contributions'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      await queryClient.invalidateQueries({ queryKey: ['collecteurs'] })
    }
  })

  const litiges = data ?? []

  function askResolve(id: string, resolution: 'CONFIRME' | 'ANNULE') {
    const note = window.prompt(resolution === 'CONFIRME' ? 'Note de confirmation' : 'Motif d annulation')
    resolve.mutate({ id, resolution, note: note ?? undefined })
  }

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">Litiges</h2>
          <p className="text-gray-500 text-sm">{litiges.length} contribution(s) a resoudre</p>
        </div>
      </div>

      <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden">
        <div className="px-5 py-4" style={{ background: 'linear-gradient(135deg, #7F1D1D, #DC2626)' }}>
          <h3 className="font-display font-semibold text-white text-sm">Contributions contestees</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                {['Membre', 'Rubrique', 'Montant', 'Mode', 'Motif', 'Date', 'Action'].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonTableRow key={i} cols={7} />)
              ) : litiges.length === 0 ? (
                <tr><td colSpan={7}><EmptyState icon={AlertTriangle} title="Aucun litige" description="Les contributions en litige apparaitront ici." /></td></tr>
              ) : (
                litiges.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-red-50/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800">{c.membre?.user.fullName ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <p className="font-mono">{c.rubrique?.code}</p>
                      <p className="text-gray-400 truncate max-w-[160px]">{c.rubrique?.title}</p>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-[#1A6B1A]">{formatAmount(c.montant)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{MODE_PAIEMENT_LABELS[c.modePaiement]}</td>
                    <td className="px-4 py-3 text-xs text-red-700 max-w-[220px]">{c.litigeMotif ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{formatDateTime(c.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button size="sm" loading={resolve.isPending} onClick={() => askResolve(c.id, 'CONFIRME')}>
                          <CheckCircle2 size={13} />
                          Confirmer
                        </Button>
                        <Button size="sm" variant="danger" loading={resolve.isPending} onClick={() => askResolve(c.id, 'ANNULE')}>
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
    </div>
  )
}
