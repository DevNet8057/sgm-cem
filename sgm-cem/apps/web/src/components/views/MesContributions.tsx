'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CreditCard, Search } from 'lucide-react'
import api from '@/lib/api'
import { formatAmount, formatDate, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Contribution } from '@/types'

export function MesContributions() {
  const { user } = useAuthStore()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['mes-contributions', page],
    queryFn: async () => (await api.get('/contributions/me', { params: { page, limit: 20 } })).data,
  })

  const contributions: Contribution[] = data?.data ?? []
  const pagination = data?.pagination

  const filtered = contributions.filter(c =>
    !search ||
    c.rubrique?.code.toLowerCase().includes(search.toLowerCase()) ||
    c.rubrique?.title.toLowerCase().includes(search.toLowerCase())
  )

  const totalConfirmed = contributions.filter(c => c.statut === 'CONFIRME').reduce((s, c) => s + c.montant, 0)

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      {/* Header */}
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#1A6B1A]" />
        <div className="p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-[#1A6B1A]">Mon espace</p>
          <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Mes contributions</h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Bonjour {user?.firstName} — Historique de vos contributions au ministère
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <SummaryCard label="Total enregistrées" value={String(pagination?.total ?? 0)} color="#1A6B1A" bg="#E8F5E8" />
        <SummaryCard label="Montant confirmé" value={formatAmount(totalConfirmed)} color="#2563EB" bg="#EFF6FF" />
        <SummaryCard
          label="En attente"
          value={String(contributions.filter(c => c.statut === 'EN_ATTENTE_CONFIRMATION').length)}
          color="#F59E0B" bg="#FEFCE8"
        />
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher par rubrique…"
          className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A]"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden shadow-[0_2px_12px_rgba(15,74,15,0.04)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                {['Rubrique', 'Montant', 'Mode', 'Statut', 'Période', 'Date'].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonTableRow key={i} cols={6} />)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6}>
                  <EmptyState
                    icon={CreditCard}
                    title="Aucune contribution"
                    description="Vos contributions apparaîtront ici une fois enregistrées."
                  />
                </td></tr>
              ) : (
                filtered.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-mono font-semibold text-xs text-gray-700">{c.rubrique?.code}</p>
                      <p className="text-xs text-gray-400 truncate max-w-[180px]">{c.rubrique?.title}</p>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-[#1A6B1A]">{formatAmount(c.montant)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{MODE_PAIEMENT_LABELS[c.modePaiement]}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.statut} /></td>
                    <td className="px-4 py-3 text-xs text-gray-400">{c.periodeLabel ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{formatDate(c.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 bg-gray-50/30">
            <p className="text-xs text-gray-500">Page {pagination.page} / {pagination.totalPages}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-[8px] disabled:opacity-40 hover:bg-gray-100">
                ← Précédent
              </button>
              <button onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page === pagination.totalPages}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-[8px] disabled:opacity-40 hover:bg-gray-100">
                Suivant →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <div className="bg-white rounded-[14px] border border-gray-100 p-4">
      <div className="w-2 h-2 rounded-full mb-2" style={{ background: color }} />
      <p className="font-display font-bold text-2xl leading-tight" style={{ color }}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}
