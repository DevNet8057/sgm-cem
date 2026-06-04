'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock, CreditCard } from 'lucide-react'
import api from '@/lib/api'
import { formatAmount, formatDateTime, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Contribution } from '@/types'

export function Validations() {
  const queryClient = useQueryClient()
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
    mutationFn: async ({ id, motif }: { id: string; motif: string }) => api.patch(`/contributions/${id}/litige`, { motif }),
    onSuccess: refreshCore,
  })

  async function refreshCore() {
    await queryClient.invalidateQueries({ queryKey: ['validations'] })
    await queryClient.invalidateQueries({ queryKey: ['contributions'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    await queryClient.invalidateQueries({ queryKey: ['monthly-stats'] })
    await queryClient.invalidateQueries({ queryKey: ['rubriques'] })
  }

  function markDispute(id: string) {
    const motif = window.prompt('Motif du litige (10 caracteres minimum)')
    if (motif && motif.trim().length >= 10) dispute.mutate({ id, motif: motif.trim() })
  }

  const validations = data ?? []
  const total = validations.reduce((sum, c) => sum + c.montant, 0)

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">Validations</h2>
          <p className="text-gray-500 text-sm">{validations.length} paiement(s) en attente</p>
        </div>
        <div className="hidden md:flex items-center gap-2 rounded-[12px] bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm text-yellow-800">
          <Clock size={15} />
          <span className="font-mono font-bold">{formatAmount(total)}</span>
        </div>
      </div>

      <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, #0F4A0F, #1A6B1A)' }}>
          <h3 className="font-display font-semibold text-white text-sm">Paiements a verifier</h3>
          <span className="text-white/70 text-xs">Confirmation manuelle</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
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
                <tr><td colSpan={7}><EmptyState icon={CheckCircle2} title="Aucune validation" description="Tout est a jour pour le moment" /></td></tr>
              ) : (
                validations.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-[#1A6B1A]/4 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800">{c.membre?.user.fullName ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <p className="font-mono">{c.rubrique?.code}</p>
                      <p className="text-gray-400 truncate max-w-[180px]">{c.rubrique?.title}</p>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-[#1A6B1A]">{formatAmount(c.montant)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{MODE_PAIEMENT_LABELS[c.modePaiement]}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{c.collecteur?.fullName ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{formatDateTime(c.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button size="sm" loading={confirm.isPending} onClick={() => confirm.mutate(c.id)}>
                          <CheckCircle2 size={13} />
                          Confirmer
                        </Button>
                        <Button size="sm" variant="danger" loading={dispute.isPending} onClick={() => markDispute(c.id)}>
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
    </div>
  )
}
