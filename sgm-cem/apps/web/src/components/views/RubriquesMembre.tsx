'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, FolderOpen, Wallet } from 'lucide-react'
import api from '@/lib/api'
import { formatAmount } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SkeletonCard } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { PaymentStepper } from '@/components/payments/PaymentStepper'
import { useFocusHighlight } from '@/hooks/useFocusHighlight'
import { cn } from '@/lib/utils'
import type { Rubrique, RemainingBalance, Membre } from '@/types'

/**
 * Rubriques ouvertes — lecture seule pour le rôle MEMBRE, avec un bouton
 * "Payer" par rubrique qui ouvre PaymentStepper en mode self-service
 * (MTN MoMo / Orange Money / Carte — même composant et mêmes routes que le
 * flow staff, verrouillé sur le membre connecté). Le paiement en espèces
 * n'est PAS proposé ici : il passe par la déclaration à double validation
 * (bouton dédié dans MesContributions.tsx).
 * Réutilise GET /api/rubriques (déjà accessible level 1, déjà trié
 * [priority desc, createdAt desc] côté backend — ne pas re-trier ici) et
 * GET /api/contributions/me/balance (calcul partagé packages/shared) pour
 * le montant restant dû.
 */
export function RubriquesMembre() {
  const [payingFor, setPayingFor] = useState<{ rubriqueId: string; montant?: number } | null>(null)

  const { data: rubriques, isLoading: loadingRubriques } = useQuery<Rubrique[]>({
    queryKey: ['rubriques'],
    queryFn: async () => (await api.get('/rubriques', { params: { status: 'OUVERTE' } })).data.data,
  })

  const { data: balances, isLoading: loadingBalances } = useQuery<RemainingBalance[]>({
    queryKey: ['mes-soldes'],
    queryFn: async () => (await api.get('/contributions/me/balance')).data.data,
  })

  // Nécessaire pour PaymentStepper (forme Membre complète — profil, couple…).
  // Chargé une seule fois, réutilisé pour toutes les rubriques de cette vue.
  const { data: myMembre } = useQuery<Membre>({
    queryKey: ['mon-membre'],
    queryFn: async () => (await api.get('/membres/me')).data.data,
    staleTime: 5 * 60 * 1000,
  })

  const isLoading = loadingRubriques || loadingBalances
  const balanceByRubrique = new Map((balances ?? []).map(b => [b.rubrique.id, b]))
  const list = rubriques ?? []
  // Permet au CTA de la bannière dashboard (MesContributions) de rebondir ici
  // et de scroller/surligner la rubrique visée — même mécanisme générique que
  // pour les notifications (appStore.navigateToNotification + data-focus-id).
  const highlightedId = useFocusHighlight(list.map(r => r.id))

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#F59E0B]" />
        <div className="p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-600">Rubriques ouvertes</p>
          <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Ce que vous pouvez encore payer</h2>
          <p className="text-gray-500 text-sm mt-0.5">Les rubriques urgentes ou prioritaires apparaissent en premier.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={FolderOpen} title="Aucune rubrique ouverte" description="Il n'y a aucune rubrique de contribution ouverte pour le moment." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-children">
          {list.map(r => (
            <RubriqueMembreCard
              key={r.id}
              rubrique={r}
              balance={balanceByRubrique.get(r.id)}
              highlighted={highlightedId === r.id}
              onPay={montant => setPayingFor({ rubriqueId: r.id, montant })}
            />
          ))}
        </div>
      )}

      {payingFor && myMembre && (
        <PaymentStepper
          selfService
          membres={[myMembre]}
          rubriques={list}
          initialRubriqueId={payingFor.rubriqueId}
          initialMontant={payingFor.montant}
          onClose={() => setPayingFor(null)}
        />
      )}
    </div>
  )
}

function RubriqueMembreCard({ rubrique: r, balance, highlighted, onPay }: {
  rubrique: Rubrique
  balance?: RemainingBalance
  highlighted?: boolean
  onPay: (montant?: number) => void
}) {
  const isUrgentOrPriority = r.priority === 'URGENT' || r.priority === 'PRIORITAIRE'
  const topColor = r.priority === 'URGENT' ? 'from-red-500 to-red-400' :
    r.priority === 'PRIORITAIRE' ? 'from-orange-500 to-amber-400' : 'from-[#1A6B1A] to-[#2D8C2D]'

  return (
    <div
      data-focus-id={r.id}
      className={cn(
        'bg-white rounded-[18px] border overflow-hidden transition-all duration-200',
        isUrgentOrPriority ? 'border-red-200 shadow-cem-sm' : 'border-gray-100',
        highlighted && 'ring-2 ring-[#1A6B1A]'
      )}>
      <div className={`h-1.5 bg-linear-to-r ${topColor}`} />
      <div className="p-5">
        <div className="flex items-start justify-between mb-3 gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-mono text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{r.code}</span>
              {r.priority !== 'NORMAL' && <StatusBadge status={r.priority} dot={false} />}
            </div>
            <h3 className="font-display font-semibold text-gray-800 text-sm leading-tight">{r.title}</h3>
            {r.description && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{r.description}</p>}
          </div>
          {r.priority === 'URGENT' && (
            <AlertTriangle size={18} className="shrink-0 text-red-500 mt-0.5" aria-hidden="true" />
          )}
        </div>

        {balance ? (
          <div className="rounded-[12px] bg-gray-50 border border-gray-100 p-3 space-y-1.5 mb-3">
            {balance.dueAmount == null ? (
              <p className="text-xs font-semibold text-gray-500">💚 Contribution libre — montant à votre convenance</p>
            ) : balance.remainingAmount === 0 ? (
              <p className="text-xs font-semibold text-[#1A6B1A]">✅ À jour sur cette rubrique</p>
            ) : (
              <>
                <p className="text-[11px] text-gray-400">Reste à payer</p>
                <p className="font-mono font-bold text-lg text-[#1A6B1A]">{formatAmount(balance.remainingAmount)}</p>
              </>
            )}
            {balance.pendingAmount > 0 && (
              <p className="text-[11px] text-amber-600 font-medium">
                {formatAmount(balance.pendingAmount)} en attente de confirmation par le collecteur
              </p>
            )}
          </div>
        ) : (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-gray-100 text-gray-500 block mb-3 w-fit">Contribution libre</span>
        )}

        <Button size="sm" className="w-full" onClick={() => onPay(balance?.remainingAmount && balance.remainingAmount > 0 ? balance.remainingAmount : undefined)}>
          <Wallet size={13} />Payer (MTN, Orange, Carte)
        </Button>
      </div>
    </div>
  )
}
