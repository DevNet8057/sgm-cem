'use client'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Clock, CreditCard, TrendingUp, Wallet } from 'lucide-react'
import api from '@/lib/api'
import { formatAmount, formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useAppStore } from '@/store/appStore'
import { Button } from '@/components/ui/Button'
import { SkeletonCard } from '@/components/ui/Skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { Contribution } from '@/types'

export function DashboardCollecteur() {
  const { user } = useAuthStore()
  const { setActiveView } = useAppStore()

  const { data: myContribs, isLoading } = useQuery<Contribution[]>({
    queryKey: ['my-contributions'],
    queryFn: async () => (await api.get('/contributions', { params: { limit: 20 } })).data.data,
    refetchInterval: 30000,
  })

  const pending   = (myContribs ?? []).filter(c => c.statut === 'EN_ATTENTE_CONFIRMATION')
  const confirmed = (myContribs ?? []).filter(c => c.statut === 'CONFIRME')
  const litiges   = (myContribs ?? []).filter(c => c.statut === 'LITIGE')
  const totalMontant = confirmed.reduce((s, c) => s + c.montant, 0)

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter space-y-5">
      {/* Banner */}
      <div className="relative overflow-hidden rounded-[20px] cross-bg"
        style={{ background: 'linear-gradient(135deg, #052005 0%, #0F4A0F 50%, #1A6B1A 100%)' }}>
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, #F5C400, transparent)', opacity: 0.08 }} />
        <div className="relative z-10 p-5">
          <p className="text-white/60 text-xs">Espace collecteur</p>
          <h1 className="font-display text-white text-2xl font-semibold">{user?.firstName} 👋</h1>
          <p className="text-white/60 text-xs mt-1">Enregistrez des paiements et suivez votre activité</p>
          <Button
            className="mt-4"
            onClick={() => setActiveView('contributions')}
            variant="yellow"
          >
            <CreditCard size={14} />
            Enregistrer un paiement
          </Button>
        </div>
      </div>

      {/* KPIs */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <KpiCard icon={Clock} label="En attente" value={String(pending.length)} color="#F5C400" bg="#FEFCE8" />
          <KpiCard icon={CheckCircle2} label="Confirmées" value={String(confirmed.length)} color="#1A6B1A" bg="#E8F5E8" />
          <KpiCard icon={TrendingUp} label="Litiges" value={String(litiges.length)} color="#DC2626" bg="#FEF2F2" />
          <KpiCard icon={Wallet} label="Total confirmé" value={formatAmount(totalMontant)} color="#2563EB" bg="#EFF6FF" />
        </div>
      )}

      {/* Dernières contributions */}
      <section className="bg-white rounded-[18px] border border-gray-100 overflow-hidden shadow-[0_2px_12px_rgba(15,74,15,0.04)]">
        <div className="px-5 py-4 flex items-center justify-between"
          style={{ background: 'linear-gradient(135deg, #0F4A0F, #1A6B1A)' }}>
          <h3 className="font-display font-semibold text-white text-sm">Mes contributions récentes</h3>
          <button onClick={() => setActiveView('contributions')} className="text-white/70 hover:text-white text-xs transition-colors">
            Voir tout →
          </button>
        </div>

        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton h-12 rounded-[10px]" />
            ))}
          </div>
        ) : (myContribs ?? []).length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            Aucune contribution enregistrée pour le moment.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {(myContribs ?? []).slice(0, 10).map(c => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/60 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{c.membre?.user.fullName ?? '—'}</p>
                  <p className="text-xs text-gray-400 truncate">{c.rubrique?.code} · {formatDateTime(c.createdAt)}</p>
                </div>
                <div className="text-right shrink-0 space-y-0.5">
                  <p className="font-mono font-bold text-sm text-[#1A6B1A]">{formatAmount(c.montant)}</p>
                  <StatusBadge status={c.statut} dot={false} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, color, bg }: {
  icon: React.ElementType; label: string; value: string; color: string; bg: string
}) {
  return (
    <div className="bg-white rounded-[18px] border border-gray-100 p-4">
      <div className="w-9 h-9 rounded-[10px] flex items-center justify-center mb-3" style={{ background: bg, color }}>
        <Icon size={17} />
      </div>
      <p className="font-display font-bold text-[#0F4A0F] text-2xl leading-tight">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  )
}
