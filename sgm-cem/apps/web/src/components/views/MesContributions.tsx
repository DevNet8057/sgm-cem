'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CreditCard, HandCoins, Search, X } from 'lucide-react'
import api from '@/lib/api'
import { cn, formatAmount, formatDate, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useAppStore } from '@/store/appStore'
import { Button } from '@/components/ui/Button'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ActivityCard } from '@/components/ui/ActivityCard'
import { useFocusHighlight } from '@/hooks/useFocusHighlight'
import type { Contribution, Rubrique } from '@/types'

export function MesContributions() {
  const { user } = useAuthStore()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [montantMin, setMontantMin] = useState('')
  const [montantMax, setMontantMax] = useState('')
  const [showDeclareForm, setShowDeclareForm] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['mes-contributions', page, montantMin, montantMax],
    queryFn: async () => (await api.get('/contributions/me', {
      params: {
        page, limit: 20,
        ...(montantMin && { montantMin }),
        ...(montantMax && { montantMax }),
      },
    })).data,
  })

  const contributions: Contribution[] = data?.data ?? []
  const pagination = data?.pagination

  const filtered = contributions.filter(c =>
    !search ||
    c.rubrique?.code.toLowerCase().includes(search.toLowerCase()) ||
    c.rubrique?.title.toLowerCase().includes(search.toLowerCase())
  )

  const totalConfirmed = contributions.filter(c => c.statut === 'CONFIRME').reduce((s, c) => s + c.montant, 0)
  const hasAmountFilter = montantMin !== '' || montantMax !== ''
  // filtered (pas contributions) : c'est la liste réellement rendue dans le DOM
  // (data-focus-id posé sur ces éléments) — comparer à la liste brute ferait
  // "consommer" le focusTarget d'une notification sans jamais pouvoir surligner
  // l'élément si un filtre de recherche local l'exclut au moment de l'arrivée.
  const highlightedId = useFocusHighlight(filtered.map(c => c.id))

  function resetPageAnd(setter: (v: string) => void) {
    return (v: string) => { setter(v); setPage(1) }
  }

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      {/* Header */}
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#1A6B1A]" />
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#1A6B1A]">Mon espace</p>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Mes contributions</h2>
            <p className="text-gray-500 text-sm mt-0.5">
              Bonjour {user?.firstName} — Historique de vos contributions au ministère
            </p>
          </div>
          <Button size="sm" onClick={() => setShowDeclareForm(v => !v)}>
            {showDeclareForm ? <X size={14} /> : <HandCoins size={14} />}
            {showDeclareForm ? 'Fermer' : 'Déclarer un paiement en espèces'}
          </Button>
        </div>
      </div>

      {showDeclareForm && (
        <DeclareCashForm onDone={() => setShowDeclareForm(false)} />
      )}

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

      {/* Search + filtre montant */}
      <div className="mb-4 space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par rubrique…"
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-500">Montant :</span>
          <input
            type="number" inputMode="numeric" min={0}
            value={montantMin}
            onChange={e => resetPageAnd(setMontantMin)(e.target.value)}
            placeholder="Min"
            className="w-24 px-2.5 py-1.5 bg-white border border-gray-200 rounded-[8px] text-xs focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A]"
          />
          <span className="text-xs text-gray-400">—</span>
          <input
            type="number" inputMode="numeric" min={0}
            value={montantMax}
            onChange={e => resetPageAnd(setMontantMax)(e.target.value)}
            placeholder="Max"
            className="w-24 px-2.5 py-1.5 bg-white border border-gray-200 rounded-[8px] text-xs focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A]"
          />
          {hasAmountFilter && (
            <button type="button" onClick={() => { setMontantMin(''); setMontantMax(''); setPage(1) }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border border-red-200 text-red-500 bg-red-50 hover:bg-red-100 transition-all">
              <X size={10} />Effacer
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden shadow-[0_2px_12px_rgba(15,74,15,0.04)]">
        <div className="hidden md:block overflow-x-auto">
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
                    description={hasAmountFilter ? 'Aucune contribution dans cette plage de montant.' : 'Vos contributions apparaîtront ici une fois enregistrées.'}
                  />
                </td></tr>
              ) : (
                filtered.map(c => (
                  <tr key={c.id} data-focus-id={c.id} className={cn(
                    'border-b border-gray-50 hover:bg-gray-50/60 transition-colors',
                    highlightedId === c.id && 'bg-[#E8F5E8] ring-2 ring-inset ring-[#1A6B1A]'
                  )}>
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

        <div className="md:hidden stagger-children space-y-2.5 p-3">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-[14px]" />)
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title="Aucune contribution"
              description={hasAmountFilter ? 'Aucune contribution dans cette plage de montant.' : 'Vos contributions apparaîtront ici une fois enregistrées.'}
            />
          ) : (
            filtered.map(c => (
              <div key={c.id} data-focus-id={c.id} className={cn(
                'rounded-[14px]', highlightedId === c.id && 'ring-2 ring-[#1A6B1A]'
              )}>
                <ActivityCard
                  avatar={
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50 text-sm font-bold text-[#1A6B1A]">
                      {MODE_PAIEMENT_LABELS[c.modePaiement]?.charAt(0)}
                    </span>
                  }
                  title={c.rubrique?.title ?? c.rubrique?.code ?? 'Contribution'}
                  subtitle={c.periodeLabel ?? formatDate(c.createdAt)}
                  trailing={
                    <>
                      <strong className="block font-mono text-sm text-[#1A6B1A]">{formatAmount(c.montant)}</strong>
                      <StatusBadge status={c.statut} />
                    </>
                  }
                />
              </div>
            ))
          )}
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

/**
 * Déclaration de paiement en espèces — RB "double validation" : le membre
 * choisit le collecteur à qui il a physiquement remis l'argent, dans la
 * liste des collecteurs actifs (GET /collecteurs/eligible-for-declaration,
 * déjà existante). La contribution reste EN_ATTENTE_CONFIRMATION jusqu'à ce
 * que CE collecteur précis confirme depuis son propre compte — jamais avant.
 */
function DeclareCashForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient()
  const { addToast } = useAppStore()
  const [rubriqueId, setRubriqueId] = useState('')
  const [collecteurId, setCollecteurId] = useState('')
  const [montant, setMontant] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const { data: rubriques, isLoading: loadingRubriques } = useQuery<Rubrique[]>({
    queryKey: ['rubriques-ouvertes'],
    queryFn: async () => (await api.get('/rubriques', { params: { status: 'OUVERTE' } })).data.data,
  })

  const { data: collecteurs, isLoading: loadingCollecteurs } = useQuery<{ id: string; fullName: string; role: string }[]>({
    queryKey: ['collecteurs-eligibles'],
    queryFn: async () => (await api.get('/collecteurs/eligible-for-declaration')).data.data,
  })

  const declare = useMutation({
    mutationFn: async () => api.post('/contributions/declare', {
      rubriqueId,
      collecteurId,
      montant: Number(montant),
      note: note || undefined,
    }),
    onSuccess: async () => {
      addToast({
        title: 'Déclaration envoyée',
        message: 'Le collecteur doit maintenant confirmer avoir reçu ce paiement.',
        variant: 'success',
      })
      await queryClient.invalidateQueries({ queryKey: ['mes-contributions'] })
      await queryClient.invalidateQueries({ queryKey: ['mes-soldes'] })
      onDone()
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setError(e.response?.data?.error?.message ?? 'Déclaration impossible')
    },
  })

  const canSubmit = rubriqueId !== '' && collecteurId !== '' && Number(montant) > 0

  return (
    <form
      onSubmit={e => { e.preventDefault(); setError(''); declare.mutate() }}
      className="mb-5 bg-white rounded-[18px] border border-gray-100 p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-display font-semibold text-[#0F4A0F]">Déclarer un paiement en espèces</h3>
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">
        Vous avez remis de l&apos;argent en main propre à un collecteur ? Déclarez-le ici. Le statut restera
        <strong> « En attente »</strong> jusqu&apos;à ce que ce collecteur confirme lui-même avoir reçu le montant.
      </p>

      <label className="block">
        <span className="text-xs font-semibold text-gray-600">Rubrique</span>
        <select value={rubriqueId} onChange={e => setRubriqueId(e.target.value)} required disabled={loadingRubriques}
          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30">
          <option value="">{loadingRubriques ? 'Chargement…' : 'Sélectionner une rubrique'}</option>
          {(rubriques ?? []).map(r => (
            <option key={r.id} value={r.id}>{r.code} — {r.title}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-semibold text-gray-600">Collecteur à qui vous avez remis l&apos;argent</span>
        <select value={collecteurId} onChange={e => setCollecteurId(e.target.value)} required disabled={loadingCollecteurs}
          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30">
          <option value="">{loadingCollecteurs ? 'Chargement…' : 'Sélectionner un collecteur'}</option>
          {(collecteurs ?? []).map(c => (
            <option key={c.id} value={c.id}>{c.fullName} ({c.role === 'TRESORIER' ? 'Trésorier' : 'Collecteur'})</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-semibold text-gray-600">Montant (FCFA)</span>
        <input type="number" inputMode="numeric" min={1} required value={montant} onChange={e => setMontant(e.target.value)}
          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30" />
      </label>

      <label className="block">
        <span className="text-xs font-semibold text-gray-600">Note (optionnel)</span>
        <input value={note} onChange={e => setNote(e.target.value)}
          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30" />
      </label>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-[10px] px-3 py-2">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>Annuler</Button>
        <Button type="submit" loading={declare.isPending} disabled={!canSubmit}>Envoyer la déclaration</Button>
      </div>
    </form>
  )
}

function SummaryCard({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <div className="bg-white rounded-[14px] border border-gray-100 p-4 interactive hover:shadow-cem-sm">
      <div className="w-2 h-2 rounded-full mb-2" style={{ background: color }} />
      <p className="font-display font-bold text-2xl leading-tight" style={{ color }}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}
