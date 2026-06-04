'use client'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Users, Clock, CheckCircle, Wallet, Plus, CreditCard, AlertTriangle } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import api from '@/lib/api'
import { formatAmount, timeAgo, progressGradient, hasMinLevel } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useAppStore } from '@/store/appStore'
import { SkeletonKPI, SkeletonCard } from '@/components/ui/Skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { DashboardStats, Contribution } from '@/types'

function useAnimatedCounter(target: number, duration = 1200): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let start = 0
    const step = target / (duration / 16)
    const timer = setInterval(() => {
      start += step
      if (start >= target) { setCount(target); clearInterval(timer) }
      else setCount(Math.floor(start))
    }, 16)
    return () => clearInterval(timer)
  }, [target, duration])
  return count
}

const MODE_ICONS: Record<string, string> = {
  MTN_MOMO: '🟡', ORANGE_MONEY: '🟠', ESPECES: '💵', CARTE_VISA: '💳', VIREMENT: '🏦'
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) => {
  if (active && payload?.length) {
    return (
      <div className="bg-white rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-gray-100 px-4 py-3">
        <p className="text-xs font-semibold text-gray-500 mb-1">{label}</p>
        <p className="text-sm font-bold text-[#1A6B1A]">{formatAmount(payload[0]?.value)}</p>
      </div>
    )
  }
  return null
}

export function Dashboard() {
  const { user } = useAuthStore()
  const { setActiveView } = useAppStore()

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => (await api.get('/stats/dashboard')).data.data,
    refetchInterval: 30000,
  })

  const { data: monthlyData } = useQuery({
    queryKey: ['monthly-stats'],
    queryFn: async () => (await api.get('/stats/monthly')).data.data,
  })

  const totalMembres = useAnimatedCounter(stats?.totalMembres ?? 0)
  const pendingConf = useAnimatedCounter(stats?.pendingConfirmations ?? 0)

  const canSeeFinancials = hasMinLevel(user?.role ?? '', 3)

  return (
    <div className="p-4 md:p-6 space-y-6 animate-page-enter pb-20 lg:pb-6">
      {/* Banner */}
      <div
        className="rounded-[20px] p-6 relative overflow-hidden cross-bg"
        style={{ background: 'linear-gradient(135deg, #0F4A0F 0%, #1A6B1A 60%, #2D8C2D 100%)' }}
      >
        <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full opacity-[0.08]"
          style={{ background: 'radial-gradient(circle, #F5C400, transparent)' }} />
        <div className="relative z-10">
          <p className="text-white/70 text-sm mb-1">Bienvenue 👋</p>
          <h2 className="font-display text-white text-2xl font-semibold mb-4">{user?.firstName}</h2>
          {canSeeFinancials && stats && (
            <div className="flex gap-3">
              <div className="px-4 py-2.5 rounded-[12px] flex-1" style={{ background: 'rgba(255,255,255,0.10)' }}>
                <p className="text-white/60 text-xs mb-0.5">Ce mois</p>
                <p className="text-white font-bold font-mono text-sm">{formatAmount(stats.totalCollectedMonth)}</p>
              </div>
              <div className="px-4 py-2.5 rounded-[12px] flex-1" style={{ background: 'rgba(255,255,255,0.10)' }}>
                <p className="text-white/60 text-xs mb-0.5">Cette année</p>
                <p className="text-white font-bold font-mono text-sm">{formatAmount(stats.totalCollectedYear)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonKPI key={i} />)
        ) : (
          <>
            <KPICard
              icon={<Users size={18} className="text-[#1A6B1A]" />}
              iconBg="bg-[#E8F5E8]"
              label="Membres actifs"
              value={totalMembres.toLocaleString('fr-FR')}
              accent="from-[#1A6B1A] to-[#2D8C2D]"
            />
            <KPICard
              icon={<Clock size={18} className="text-amber-600" />}
              iconBg="bg-amber-50"
              label="En retard"
              value={(stats?.membresEnRetard ?? 0).toLocaleString('fr-FR')}
              accent="from-amber-500 to-amber-400"
              badge={stats?.membresEnRetard ? { text: 'Attention', color: 'bg-amber-100 text-amber-700' } : undefined}
            />
            <KPICard
              icon={<CheckCircle size={18} className="text-[#1A6B1A]" />}
              iconBg="bg-[#E8F5E8]"
              label="Confirmations"
              value={pendingConf.toLocaleString('fr-FR')}
              accent="from-[#1A6B1A] to-[#2D8C2D]"
              badge={stats?.pendingConfirmations ? { text: 'En attente', color: 'bg-yellow-100 text-yellow-700' } : undefined}
            />
            <KPICard
              icon={<Wallet size={18} className="text-purple-600" />}
              iconBg="bg-purple-50"
              label="Rubriques ouvertes"
              value={(stats?.rubriquesActives?.length ?? 0).toLocaleString('fr-FR')}
              accent="from-purple-500 to-purple-400"
            />
          </>
        )}
      </div>

      {/* Charts row */}
      {canSeeFinancials && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Monthly bar chart */}
          <div className="lg:col-span-2 bg-white rounded-[18px] border border-gray-100 p-5">
            <h3 className="font-display font-semibold text-gray-800 mb-4">Collectes mensuelles 2025</h3>
            {monthlyData ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={monthlyData} barSize={24}>
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis hide />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(26,107,26,0.05)' }} />
                  <Bar dataKey="total" radius={[8, 8, 0, 0]}>
                    {monthlyData.map((entry: { month: number }, index: number) => (
                      <Cell
                        key={index}
                        fill={entry.month === new Date().getMonth() + 1 ? '#F5C400' : '#1A6B1A'}
                        fillOpacity={entry.month === new Date().getMonth() + 1 ? 1 : 0.8}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-44 skeleton rounded-[12px]" />
            )}
          </div>

          {/* Rubriques progression */}
          <div className="bg-white rounded-[18px] border border-gray-100 p-5">
            <h3 className="font-display font-semibold text-gray-800 mb-4">Rubriques actives</h3>
            <div className="space-y-3">
              {stats?.rubriquesActives?.slice(0, 4).map(r => {
                const ratio = r.targetAmount ? (r.totalCollecte ?? 0) / r.targetAmount : 0
                return (
                  <div key={r.id}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-gray-700 truncate flex-1 mr-2">{r.code}</p>
                      <p className="text-xs font-mono text-gray-500">{formatAmount(r.totalCollecte)}</p>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, ratio * 100)}%`,
                          background: progressGradient(ratio),
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Recent activity + Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent contributions */}
        <div className="lg:col-span-2 bg-white rounded-[18px] border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between"
            style={{ background: 'linear-gradient(135deg, #0F4A0F, #1A6B1A)' }}>
            <h3 className="font-display font-semibold text-white text-sm">Activité récente</h3>
            <button onClick={() => setActiveView('contributions')} className="text-white/60 hover:text-white text-xs transition-colors">
              Voir tout →
            </button>
          </div>
          <div className="divide-y divide-gray-50">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-5 py-3 flex items-center gap-3">
                  <div className="skeleton w-8 h-8 rounded-[8px]" />
                  <div className="flex-1 space-y-1.5">
                    <div className="skeleton h-3 w-3/4 rounded" />
                    <div className="skeleton h-2.5 w-1/2 rounded" />
                  </div>
                </div>
              ))
            ) : stats?.recentContributions?.length ? (
              stats.recentContributions.slice(0, 8).map(c => (
                <ContributionRow key={c.id} contribution={c} />
              ))
            ) : (
              <div className="py-8 text-center text-gray-400 text-sm">Aucune activité récente</div>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="bg-white rounded-[18px] border border-gray-100 p-5">
          <h3 className="font-display font-semibold text-gray-800 mb-4">Actions rapides</h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: Plus, label: 'Nouvelle rubrique', color: '#1A6B1A', bg: '#E8F5E8', view: 'rubriques' },
              { icon: CreditCard, label: 'Enregistrer paiement', color: '#1A6B1A', bg: '#E8F5E8', view: 'contributions' },
              { icon: Users, label: 'Ajouter membre', color: '#1A6B1A', bg: '#E8F5E8', view: 'membres' },
              { icon: AlertTriangle, label: 'Rubrique urgente', color: '#DC2626', bg: '#FEE2E2', view: 'rubriques' },
            ].map(action => (
              <button
                key={action.label}
                onClick={() => setActiveView(action.view)}
                className="flex flex-col items-center gap-2 p-3 rounded-[14px] border-2 border-dashed border-gray-200 hover:border-current transition-all group text-center"
                style={{ '--hover-color': action.color } as React.CSSProperties}
              >
                <div className="w-9 h-9 rounded-[10px] flex items-center justify-center" style={{ background: action.bg }}>
                  <action.icon size={16} style={{ color: action.color }} />
                </div>
                <span className="text-[11px] font-medium text-gray-600 leading-tight">{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function KPICard({ icon, iconBg, label, value, accent, badge }: {
  icon: React.ReactNode; iconBg: string; label: string; value: string; accent: string; badge?: { text: string; color: string }
}) {
  return (
    <div className="bg-white rounded-[18px] border border-gray-100 p-4 relative overflow-hidden hover:shadow-cem-lg hover:-translate-y-0.5 transition-all duration-200">
      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${accent} rounded-t-[18px]`} />
      <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-gray-50 opacity-50" />
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center ${iconBg}`}>{icon}</div>
        {badge && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.color}`}>{badge.text}</span>}
      </div>
      <p className="font-display font-bold text-gray-900 text-2xl leading-tight">{value}</p>
      <p className="text-gray-500 text-xs mt-0.5">{label}</p>
    </div>
  )
}

function ContributionRow({ contribution: c }: { contribution: Contribution }) {
  return (
    <div className="px-5 py-3 flex items-center gap-3 hover:bg-[#1A6B1A]/4 cursor-pointer transition-colors group">
      <div className="w-8 h-8 rounded-[8px] bg-gray-100 flex items-center justify-center flex-shrink-0 text-base">
        {MODE_ICONS[c.modePaiement] ?? '💰'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{c.membre?.user.fullName ?? '—'}</p>
        <p className="text-xs text-gray-400 truncate">{c.rubrique?.title} · {timeAgo(c.createdAt)}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-bold text-[#1A6B1A] font-mono">{formatAmount(c.montant)}</p>
        <StatusBadge status={c.statut} dot={false} />
      </div>
    </div>
  )
}
