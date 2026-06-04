'use client'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Landmark, RefreshCw, Wallet } from 'lucide-react'
import api from '@/lib/api'
import { formatAmount, formatDate, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import type { CollecteursResponse, Contribution, LocalisationFonds } from '@/types'

const LOCATION_LABELS: Record<string, string> = {
  CHEZ_COLLECTEUR: 'Chez collecteur',
  EN_TRANSIT: 'En transit',
  CAISSE_PRINCIPALE: 'Caisse principale',
  BANQUE: 'Banque',
}

export function Collecteurs() {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string[]>([])
  const [destination, setDestination] = useState<Extract<LocalisationFonds, 'CAISSE_PRINCIPALE' | 'BANQUE'>>('CAISSE_PRINCIPALE')
  const [error, setError] = useState('')

  const { data, isLoading, refetch } = useQuery<CollecteursResponse>({
    queryKey: ['collecteurs'],
    queryFn: async () => (await api.get('/collecteurs')).data.data,
    refetchInterval: 30000,
  })

  const transfer = useMutation({
    mutationFn: async () => api.patch('/collecteurs/transfer', {
      contributionIds: selected,
      localisationFonds: destination,
    }),
    onSuccess: async () => {
      setSelected([])
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['collecteurs'] })
      await queryClient.invalidateQueries({ queryKey: ['contributions'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setError(e.response?.data?.error?.message ?? 'Transfert impossible')
    }
  })

  const contributions = data?.contributions ?? []
  const selectedTotal = useMemo(
    () => contributions.filter(c => selected.includes(c.id)).reduce((sum, c) => sum + c.montant, 0),
    [contributions, selected]
  )

  function toggle(id: string) {
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  function toggleAll() {
    setSelected(current => current.length === contributions.length ? [] : contributions.map(c => c.id))
  }

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">Fonds Collecteurs</h2>
          <p className="text-gray-500 text-sm">Suivi des fonds confirmes non encore reverses</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RefreshCw size={14} />
          Actualiser
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="A remettre" value={formatAmount(data?.totals.totalARemettre ?? 0)} />
        <Kpi label="Contributions" value={String(data?.totals.totalContributions ?? 0)} />
        <Kpi label="En retard" value={String(data?.totals.totalEnRetard ?? 0)} tone={(data?.totals.totalEnRetard ?? 0) > 0 ? 'warning' : 'default'} />
        <Kpi label="Delai max" value={`${data?.totals.maxRetentionDays ?? 7} jour(s)`} />
      </div>

      {(data?.summary?.length ?? 0) > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-5">
          {data!.summary.map(item => (
            <div key={item.collecteurId} className="bg-white border border-gray-100 rounded-[18px] p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-display font-semibold text-[#0F4A0F]">{item.collecteurName}</p>
                  <p className="text-xs text-gray-400">{item.collecteurEmail ?? 'Aucun email'}</p>
                </div>
                {item.nbEnRetard > 0 && <AlertTriangle size={18} className="text-amber-500" />}
              </div>
              <div className="space-y-2 text-sm">
                <MoneyRow label="Chez collecteur" value={item.totalChezCollecteur} />
                <MoneyRow label="En transit" value={item.totalEnTransit} />
                <MoneyRow label="Total" value={item.totalARemettre} strong />
              </div>
              <p className="mt-3 text-xs text-gray-400">
                {item.nbContributions} contribution(s)
                {item.oldestContributionAt ? ` - plus ancien: ${formatDate(item.oldestContributionAt)}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
          style={{ background: 'linear-gradient(135deg, #0F4A0F, #1A6B1A)' }}>
          <div>
            <h3 className="font-display font-semibold text-white text-sm">Contributions a reverser</h3>
            <p className="text-white/60 text-xs">{selected.length} selectionnee(s), {formatAmount(selectedTotal)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={destination} onChange={e => setDestination(e.target.value as typeof destination)}
              className="px-3 py-2 rounded-[10px] text-sm bg-white border-0 focus:outline-none">
              <option value="CAISSE_PRINCIPALE">Vers caisse</option>
              <option value="BANQUE">Vers banque</option>
            </select>
            <Button variant="yellow" disabled={selected.length === 0} loading={transfer.isPending} onClick={() => transfer.mutate()}>
              <Landmark size={14} />
              Transferer
            </Button>
          </div>
        </div>

        {error && <div className="m-4 px-3 py-2 rounded-[10px] bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left">
                  <input type="checkbox" checked={contributions.length > 0 && selected.length === contributions.length} onChange={toggleAll} />
                </th>
                {['Membre', 'Rubrique', 'Collecteur', 'Montant', 'Mode', 'Localisation', 'Date'].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonTableRow key={i} cols={8} />)
              ) : contributions.length === 0 ? (
                <tr><td colSpan={8}><EmptyState icon={Wallet} title="Aucun fonds a reverser" description="Les contributions confirmees chez les collecteurs apparaitront ici." /></td></tr>
              ) : (
                contributions.map(c => (
                  <ContributionRow key={c.id} contribution={c} selected={selected.includes(c.id)} onToggle={() => toggle(c.id)} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ContributionRow({ contribution: c, selected, onToggle }: {
  contribution: Contribution
  selected: boolean
  onToggle: () => void
}) {
  return (
    <tr className="border-b border-gray-50 hover:bg-[#1A6B1A]/4 transition-colors">
      <td className="px-4 py-3"><input type="checkbox" checked={selected} onChange={onToggle} /></td>
      <td className="px-4 py-3 font-medium text-gray-800">{c.membre?.user.fullName ?? '-'}</td>
      <td className="px-4 py-3 text-xs text-gray-600">
        <p className="font-mono">{c.rubrique?.code}</p>
        <p className="text-gray-400 truncate max-w-[160px]">{c.rubrique?.title}</p>
      </td>
      <td className="px-4 py-3 text-xs text-gray-500">{c.collecteur?.fullName ?? '-'}</td>
      <td className="px-4 py-3 font-mono font-bold text-[#1A6B1A]">{formatAmount(c.montant)}</td>
      <td className="px-4 py-3 text-xs text-gray-500">{MODE_PAIEMENT_LABELS[c.modePaiement]}</td>
      <td className="px-4 py-3 text-xs text-gray-500">{LOCATION_LABELS[c.localisationFonds ?? ''] ?? '-'}</td>
      <td className="px-4 py-3 text-xs text-gray-400">{formatDate(c.createdAt)}</td>
    </tr>
  )
}

function Kpi({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warning' }) {
  return (
    <div className={`bg-white rounded-[18px] border p-4 ${tone === 'warning' ? 'border-amber-200' : 'border-gray-100'}`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`font-display font-bold text-2xl ${tone === 'warning' ? 'text-amber-600' : 'text-[#0F4A0F]'}`}>{value}</p>
    </div>
  )
}

function MoneyRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono ${strong ? 'font-bold text-[#1A6B1A]' : 'text-gray-700'}`}>{formatAmount(value)}</span>
    </div>
  )
}
