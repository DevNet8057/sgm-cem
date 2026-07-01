'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar, BarChart, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { BarChart3, CreditCard, TrendingUp, Users, Wallet } from 'lucide-react'
import api from '@/lib/api'
import { formatAmount, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import { SkeletonCard } from '@/components/ui/Skeleton'
import type { DashboardStats } from '@/types'

interface MonthlyStat {
  month: number
  label: string
  total: number
  count: number
  confirmationRate: number
}

const MODE_COLORS: Record<string, string> = {
  ESPECES: '#16A34A',
  MTN_MOMO: '#F5C400',
  ORANGE_MONEY: '#F97316',
  YELII: '#7E22CE',
  CARTE_VISA: '#2563EB',
  VIREMENT: '#7C3AED',
}

const GROUPE_COLORS = ['#1A6B1A', '#2563EB', '#F5C400', '#F97316', '#7C3AED', '#DC2626']

export function Statistiques() {
  const [chartTab, setChartTab] = useState<'montants' | 'taux'>('montants')

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => (await api.get('/stats/dashboard')).data.data,
  })

  const { data: monthly, isLoading: monthlyLoading } = useQuery<MonthlyStat[]>({
    queryKey: ['monthly-stats'],
    queryFn: async () => (await api.get('/stats/monthly')).data.data,
  })

  const bestMonth = monthly?.reduce<MonthlyStat | null>(
    (best, item) => !best || item.total > best.total ? item : best, null
  )

  const statusData = stats ? [
    { name: 'Confirmées', value: stats.contributionStatus.confirmed, color: '#1A6B1A' },
    { name: 'En attente', value: stats.contributionStatus.pending, color: '#F5C400' },
    { name: 'Litiges', value: stats.contributionStatus.litiges, color: '#DC2626' },
  ].filter(d => d.value > 0) : []

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      {/* Header */}
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#7C3AED]" />
        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-purple-600">Analyse</p>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Statistiques</h2>
            <p className="text-gray-500 text-sm mt-0.5">Vue financière et opérationnelle du ministère</p>
          </div>
          <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-3 py-1.5 rounded-full">
            {new Date().getFullYear()}
          </span>
        </div>
      </div>

      {/* KPIs */}
      {statsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Kpi icon={Users} label="Membres actifs" value={String(stats?.totalMembres ?? 0)} color="#2563EB" />
          <Kpi icon={Wallet} label="Collecte annuelle" value={formatAmount(stats?.totalCollectedYear ?? 0)} color="#1A6B1A" />
          <Kpi icon={CreditCard} label="Ce mois-ci" value={formatAmount(stats?.totalCollectedMonth ?? 0)} color="#F5C400" textColor="#C4A000" />
          <Kpi icon={TrendingUp} label="Meilleur mois" value={bestMonth ? formatAmount(bestMonth.total) : '—'} color="#7C3AED" />
        </div>
      )}

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-5 mb-5">
        {/* Monthly chart */}
        <section className="bg-white rounded-[18px] border border-gray-100 p-5 shadow-[0_2px_12px_rgba(15,74,15,0.04)]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-[#0F4A0F]">Collectes mensuelles</h3>
            <div className="flex rounded-[10px] border border-gray-200 overflow-hidden text-xs">
              <button
                onClick={() => setChartTab('montants')}
                className={`px-3 py-1.5 transition-colors ${chartTab === 'montants' ? 'bg-[#1A6B1A] text-white' : 'bg-white text-gray-500'}`}
              >
                Montants
              </button>
              <button
                onClick={() => setChartTab('taux')}
                className={`px-3 py-1.5 transition-colors ${chartTab === 'taux' ? 'bg-[#1A6B1A] text-white' : 'bg-white text-gray-500'}`}
              >
                Taux
              </button>
            </div>
          </div>
          {monthlyLoading ? (
            <div className="h-72 skeleton rounded-[12px]" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthly ?? []} barSize={26}>
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis hide />
                <Tooltip content={chartTab === 'montants' ? <MoneyTooltip /> : <RateTooltip />} cursor={{ fill: 'rgba(26,107,26,0.05)' }} />
                <Bar dataKey={chartTab === 'montants' ? 'total' : 'confirmationRate'} radius={[8, 8, 0, 0]}>
                  {(monthly ?? []).map(entry => (
                    <Cell
                      key={entry.month}
                      fill={chartTab === 'montants'
                        ? (entry.month === new Date().getMonth() + 1 ? '#F5C400' : '#1A6B1A')
                        : (entry.confirmationRate >= 80 ? '#1A6B1A' : entry.confirmationRate >= 50 ? '#F5C400' : '#EF4444')
                      }
                      fillOpacity={chartTab === 'montants' && entry.total === 0 ? 0.2 : 0.9}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* Status donut */}
        <section className="bg-white rounded-[18px] border border-gray-100 p-5 shadow-[0_2px_12px_rgba(15,74,15,0.04)]">
          <h3 className="font-display font-semibold text-[#0F4A0F] mb-4">Statut des contributions</h3>
          {statsLoading ? (
            <div className="h-60 skeleton rounded-[12px]" />
          ) : statusData.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-gray-400 text-sm">Aucune donnée</div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={statusData} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3}>
                    {statusData.map(item => (
                      <Cell key={item.name} fill={item.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [v, '']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="w-full space-y-2">
                {statusData.map(item => (
                  <div key={item.name} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-gray-600">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: item.color }} />
                      {item.name}
                    </span>
                    <span className="font-mono font-semibold text-gray-800">
                      {item.value}
                      <span className="text-gray-400 text-xs ml-1.5">
                        ({stats?.contributionStatus.total ? Math.round(item.value / stats.contributionStatus.total * 100) : 0}%)
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Moyens de paiement */}
        <section className="bg-white rounded-[18px] border border-gray-100 p-5 shadow-[0_2px_12px_rgba(15,74,15,0.04)]">
          <h3 className="font-display font-semibold text-[#0F4A0F] mb-4">Répartition par moyen de paiement</h3>
          {statsLoading ? (
            <div className="h-56 skeleton rounded-[12px]" />
          ) : (stats?.modePaiementStats?.length ?? 0) === 0 ? (
            <div className="h-56 flex items-center justify-center text-gray-400 text-sm">Aucune contribution confirmée</div>
          ) : (
            <div className="space-y-3">
              {(stats?.modePaiementStats ?? []).map(item => (
                <div key={item.modePaiement}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="flex items-center gap-2 text-sm text-gray-700">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: MODE_COLORS[item.modePaiement] ?? '#94a3b8' }} />
                      {MODE_PAIEMENT_LABELS[item.modePaiement]}
                    </span>
                    <span className="text-xs font-mono font-semibold text-gray-600">{item.count} ({item.share}%)</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${item.share}%`, background: MODE_COLORS[item.modePaiement] ?? '#94a3b8' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Taux par rubrique */}
        <section className="bg-white rounded-[18px] border border-gray-100 p-5 shadow-[0_2px_12px_rgba(15,74,15,0.04)]">
          <h3 className="font-display font-semibold text-[#0F4A0F] mb-4">Taux de collecte par rubrique</h3>
          {statsLoading ? (
            <div className="h-56 skeleton rounded-[12px]" />
          ) : (stats?.contributionRates?.length ?? 0) === 0 ? (
            <div className="h-56 flex items-center justify-center text-gray-400 text-sm">Aucune rubrique avec collecte</div>
          ) : (
            <div className="space-y-3">
              {(stats?.contributionRates ?? []).slice(0, 6).map(item => {
                const rate = item.rate ?? 0
                return (
                  <div key={item.rubriqueId}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-gray-700 truncate max-w-[160px]">{item.code}</span>
                      <span className="text-xs font-mono text-gray-500">
                        {item.rate == null ? 'Libre' : `${item.rate}%`}
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.min(100, rate)}%`,
                          background: rate >= 80 ? '#1A6B1A' : rate >= 50 ? '#F5C400' : '#EF4444',
                        }}
                      />
                    </div>
                    <div className="flex justify-between mt-0.5 text-[10px] text-gray-400">
                      <span>{formatAmount(item.total)}</span>
                      <span>{item.count} paiement(s)</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Kpi({ icon: Icon, label, value, color, textColor }: {
  icon: React.ElementType; label: string; value: string; color: string; textColor?: string
}) {
  return (
    <div className="bg-white rounded-[18px] border border-gray-100 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
      <div className="w-10 h-10 rounded-[12px] flex items-center justify-center mb-3" style={{ background: `${color}18`, color }}>
        <Icon size={18} />
      </div>
      <p className="font-display font-bold text-[#0F4A0F] text-2xl leading-tight" style={textColor ? { color: textColor } : {}}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  )
}

function MoneyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-gray-100 px-4 py-3">
      <p className="text-xs font-semibold text-gray-500 mb-1">{label}</p>
      <p className="text-sm font-bold text-[#1A6B1A]">{formatAmount(payload[0].value)}</p>
    </div>
  )
}

function RateTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-gray-100 px-4 py-3">
      <p className="text-xs font-semibold text-gray-500 mb-1">{label}</p>
      <p className="text-sm font-bold text-[#1A6B1A]">{payload[0].value}% confirmé</p>
    </div>
  )
}
