'use client'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, ArrowRight, CreditCard, Search, Wallet, X } from 'lucide-react'
import api from '@/lib/api'
import { cn, formatAmount, formatDate, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ActivityCard } from '@/components/ui/ActivityCard'
import { PaymentStepper } from '@/components/payments/PaymentStepper'
import { useFocusHighlight } from '@/hooks/useFocusHighlight'
import type { Contribution, Membre, RemainingBalance, Rubrique } from '@/types'

export function MesContributions() {
  const { user } = useAuthStore()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [montantMin, setMontantMin] = useState('')
  const [montantMax, setMontantMax] = useState('')
  const [payingFor, setPayingFor] = useState<{ rubriqueId?: string; montant?: number } | null>(null)

  // Mêmes queryKeys que RubriquesMembre.tsx : react-query dédoublonne la requête
  // si le membre visite les deux vues, sans logique de cache à maintenir ici.
  const { data: openRubriques, isLoading: loadingRubriques } = useQuery<Rubrique[]>({
    queryKey: ['rubriques'],
    queryFn: async () => (await api.get('/rubriques', { params: { status: 'OUVERTE' } })).data.data,
  })
  const { data: balances } = useQuery<RemainingBalance[]>({
    queryKey: ['mes-soldes'],
    queryFn: async () => (await api.get('/contributions/me/balance')).data.data,
  })

  const { data: myMembre, isLoading: loadingMyMembre } = useQuery<Membre>({
    queryKey: ['mon-membre'],
    queryFn: async () => (await api.get('/membres/me')).data.data,
    staleTime: 5 * 60 * 1000,
  })

  // Rappels réels uniquement — jamais de compte à rebours ni de "X personnes ont
  // déjà contribué" : soit un solde réellement dû (remainingAmount > 0), soit une
  // rubrique déjà marquée URGENT/PRIORITAIRE en base (fait réel, pas fabriqué ici).
  const reminders = useMemo(() => {
    const balanceByRubrique = new Map((balances ?? []).map(b => [b.rubrique.id, b]))
    const items = (openRubriques ?? [])
      .map(r => ({ rubrique: r, balance: balanceByRubrique.get(r.id) }))
      .filter(({ rubrique: r, balance: b }) =>
        (b?.remainingAmount != null && b.remainingAmount > 0) ||
        r.priority === 'URGENT' || r.priority === 'PRIORITAIRE'
      )

    const urgent = items
      .filter(({ rubrique: r }) => r.priority === 'URGENT' || r.priority === 'PRIORITAIRE')
      .sort((a, b) => {
        if (a.rubrique.priority !== b.rubrique.priority) return a.rubrique.priority === 'URGENT' ? -1 : 1
        if (!a.rubrique.closeDate && !b.rubrique.closeDate) return 0
        if (!a.rubrique.closeDate) return 1
        if (!b.rubrique.closeDate) return -1
        return new Date(a.rubrique.closeDate).getTime() - new Date(b.rubrique.closeDate).getTime()
      })
    const calm = items.filter(({ rubrique: r }) => r.priority === 'NORMAL')

    return { urgent, calm, total: items.length }
  }, [openRubriques, balances])

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
          <Button
            size="sm"
            loading={loadingRubriques || loadingMyMembre}
            disabled={!myMembre || (openRubriques?.length ?? 0) === 0}
            onClick={() => setPayingFor({})}
          >
            <Wallet size={14} />
            Faire une contribution
          </Button>
        </div>
      </div>

      <ContributionReminderBanner
        reminders={reminders}
        onContribute={(rubriqueId, montant) => setPayingFor({ rubriqueId, montant })}
      />

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

      {payingFor && myMembre && (
        <PaymentStepper
          selfService
          membres={[myMembre]}
          rubriques={openRubriques ?? []}
          initialRubriqueId={payingFor.rubriqueId}
          initialMontant={payingFor.montant}
          onClose={() => setPayingFor(null)}
        />
      )}
    </div>
  )
}

type ReminderItem = { rubrique: Rubrique; balance?: RemainingBalance }

/**
 * Bannière proactive — visible dès la connexion (haut de "Mes contributions",
 * l'écran d'accueil réel du MEMBRE), pas enterrée dans un sous-menu.
 * URGENT/PRIORITAIRE réutilise exactement le style .badge-urgent /
 * StatusBadge déjà défini (rouge, pulse) — aucune nouvelle palette. Le CTA
 * ouvre directement le moteur de paiement self-service avec la rubrique et le
 * solde restant préremplis quand ils sont disponibles.
 * Rappels réels uniquement : ni compte à rebours, ni "X personnes ont déjà
 * contribué" — seulement un solde réellement dû ou un statut de priorité déjà
 * fixé en base par un responsable.
 */
function ContributionReminderBanner({ reminders, onContribute }: {
  reminders: { urgent: ReminderItem[]; calm: ReminderItem[]; total: number }
  onContribute: (rubriqueId: string, montant?: number) => void
}) {
  const reduceMotion = useReducedMotion()
  const { urgent, calm, total } = reminders
  if (total === 0) return null

  const isUrgent = urgent.length > 0
  const top = isUrgent ? urgent[0] : calm[0]
  const extraCount = (isUrgent ? urgent.length : calm.length) - 1
  const soldeLabel = top.balance?.dueAmount == null
    ? 'Contribution libre — montant à votre convenance'
    : `${formatAmount(top.balance.remainingAmount)} restant à payer`

  return (
    <div className={cn(
      'relative overflow-hidden rounded-[18px] border p-5 mb-6 flex flex-col sm:flex-row sm:items-center gap-4',
      isUrgent ? 'bg-[#FEF2F2] border-[#FCA5A5]' : 'bg-white border-gray-100'
    )}>
      <div className={cn(
        'w-11 h-11 rounded-full flex items-center justify-center shrink-0',
        isUrgent ? 'bg-[#7F1D1D]/10' : 'bg-[#E8F5E8]'
      )}>
        {isUrgent
          ? <AlertTriangle size={20} className="text-[#7F1D1D] animate-[urgence-pulse_2s_ease-in-out_infinite]" />
          : <Wallet size={20} className="text-[#1A6B1A]" />}
      </div>

      <div className="flex-1 min-w-0">
        <p className={cn('text-xs font-bold uppercase tracking-widest', isUrgent ? 'text-[#7F1D1D]' : 'text-[#1A6B1A]')}>
          {isUrgent ? 'Rubrique urgente ou prioritaire' : 'Vous pouvez encore contribuer'}
        </p>
        <h3 className={cn('font-display font-semibold text-base', isUrgent ? 'text-[#7F1D1D]' : 'text-gray-800')}>
          {top.rubrique.title}
        </h3>
        <p className="text-sm text-gray-600 mt-0.5">
          {soldeLabel}
          {top.rubrique.closeDate && ` · à régler avant le ${formatDate(top.rubrique.closeDate)}`}
        </p>
        {extraCount > 0 && (
          <p className="text-xs text-gray-400 mt-1">+ {extraCount} autre{extraCount > 1 ? 's' : ''} rubrique{extraCount > 1 ? 's' : ''} ouverte{extraCount > 1 ? 's' : ''}</p>
        )}
      </div>

      <motion.div
        className="shrink-0"
        animate={isUrgent && !reduceMotion ? { scale: [1, 1.03, 1] } : undefined}
        transition={isUrgent && !reduceMotion ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : undefined}
      >
        <Button
          size="sm"
          onClick={() => onContribute(
            top.rubrique.id,
            top.balance?.remainingAmount && top.balance.remainingAmount > 0
              ? top.balance.remainingAmount
              : undefined
          )}
        >
          <ArrowRight size={13} />
          {isUrgent ? 'Contribuer maintenant' : 'Faire une contribution'}
        </Button>
      </motion.div>
    </div>
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
