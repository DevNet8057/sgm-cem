'use client'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle, BarChart3, CheckCircle2, CreditCard, Crown, FileText,
  FolderOpen, TrendingUp, Users, Wallet
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import api from '@/lib/api'
import { formatAmount, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { SkeletonCard } from '@/components/ui/Skeleton'
import type { DashboardStats, ModePaiement } from '@/types'

interface MonthlyStat {
  month: number
  label: string
  total: number
  count: number
  pending: number
  litiges: number
  confirmationRate: number
}

const MODE_COLORS: Record<ModePaiement, string> = {
  ESPECES: '#16A34A',
  MTN_MOMO: '#F5C400',
  ORANGE_MONEY: '#F97316',
  CARTE_VISA: '#2563EB',
  VIREMENT: '#7C3AED',
}

export function Dashboard() {
  const { setActiveView } = useAppStore()
  const [year, setYear] = useState(new Date().getFullYear())
  const [chartMode, setChartMode] = useState<'montants' | 'taux'>('montants')

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats', year],
    queryFn: async () => (await api.get('/stats/dashboard', { params: { year } })).data.data,
    refetchInterval: 30000,
  })

  const { data: monthlyData, isLoading: monthlyLoading } = useQuery<MonthlyStat[]>({
    queryKey: ['monthly-stats', year],
    queryFn: async () => (await api.get('/stats/monthly', { params: { year } })).data.data,
  })

  const monthlyTotal = useMemo(
    () => (monthlyData ?? []).reduce((sum, item) => sum + item.total, 0),
    [monthlyData]
  )

  return (
    <div className="p-4 md:p-6 space-y-5 animate-page-enter pb-20 lg:pb-6 bg-[#F7FAF7] min-h-full">
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#F5C400]" />
        <div className="p-5 md:p-6 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#1A6B1A]">SGM-CEM</p>
            <h1 className="font-display text-[#0F4A0F] text-3xl font-semibold leading-tight">
              Tableau de bord financier
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Suivi des contributions, validations, rubriques et performances de collecte.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setYear(y => y - 1)} className="px-3 py-2 rounded-[10px] border border-gray-200 text-sm hover:bg-gray-50">-</button>
            <select value={year} onChange={e => setYear(Number(e.target.value))}
              className="px-4 py-2 rounded-[10px] border border-gray-200 text-sm font-semibold bg-white">
              {[year - 2, year - 1, year, year + 1].map(item => <option key={item} value={item}>{item}</option>)}
            </select>
            <button onClick={() => setYear(y => y + 1)} className="px-3 py-2 rounded-[10px] border border-gray-200 text-sm hover:bg-gray-50">+</button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard icon={<Wallet size={18} />} title="Collecte annuelle" value={formatAmount(stats?.totalCollectedYear ?? 0)} tone="green" onClick={() => setActiveView('contributions')} />
          <MetricCard icon={<TrendingUp size={18} />} title="Collecte ce mois" value={formatAmount(stats?.totalCollectedMonth ?? 0)} tone="yellow" onClick={() => setActiveView('statistiques')} />
          <MetricCard icon={<CheckCircle2 size={18} />} title="Taux confirmation" value={`${stats?.globalConfirmationRate ?? 0}%`} tone="blue" onClick={() => setActiveView('validations')} />
          <MetricCard icon={<AlertTriangle size={18} />} title="Litiges" value={String(stats?.litiges ?? 0)} tone="red" onClick={() => setActiveView('litiges')} />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-5">
        <Panel
          title="Collectes mensuelles"
          action={(
            <div className="flex rounded-[10px] border border-gray-200 overflow-hidden text-xs">
              <button onClick={() => setChartMode('montants')} className={`px-3 py-1.5 ${chartMode === 'montants' ? 'bg-[#1A6B1A] text-white' : 'bg-white text-gray-500'}`}>Montants</button>
              <button onClick={() => setChartMode('taux')} className={`px-3 py-1.5 ${chartMode === 'taux' ? 'bg-[#1A6B1A] text-white' : 'bg-white text-gray-500'}`}>Taux</button>
            </div>
          )}
        >
          {monthlyLoading ? (
            <div className="h-80 skeleton rounded-[12px]" />
          ) : chartMode === 'montants' ? (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={monthlyData ?? []}>
                <defs>
                  <linearGradient id="amountFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1A6B1A" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#1A6B1A" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip content={<MoneyTooltip />} />
                <Area type="monotone" dataKey="total" stroke="#1A6B1A" strokeWidth={3} fill="url(#amountFill)" />
                <Bar dataKey="count" fill="#F5C400" radius={[5, 5, 0, 0]} yAxisId={0} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={monthlyData ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <YAxis hide domain={[0, 100]} />
                <Tooltip content={<RateTooltip />} />
                <Bar dataKey="confirmationRate" radius={[8, 8, 0, 0]}>
                  {(monthlyData ?? []).map(item => (
                    <Cell key={item.month} fill={item.confirmationRate >= 80 ? '#1A6B1A' : item.confirmationRate >= 50 ? '#F59E0B' : '#DC2626'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <span>Total graphe: <strong className="text-[#0F4A0F] font-mono">{formatAmount(monthlyTotal)}</strong></span>
            <span>{stats?.totalConfirmedContributions ?? 0} contribution(s) confirmee(s)</span>
          </div>
        </Panel>

        <Panel title="Moyens de contribution">
          {(stats?.modePaiementStats?.length ?? 0) === 0 ? (
            <EmptyMini icon={<CreditCard size={20} />} text="Aucune contribution confirmee" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] xl:grid-cols-1 gap-4">
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie data={stats?.modePaiementStats ?? []} dataKey="count" nameKey="modePaiement" innerRadius={48} outerRadius={76} paddingAngle={3}>
                    {(stats?.modePaiementStats ?? []).map(item => (
                      <Cell key={item.modePaiement} fill={MODE_COLORS[item.modePaiement]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ModeTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {(stats?.modePaiementStats ?? []).map(item => (
                  <div key={item.modePaiement} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-gray-600">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: MODE_COLORS[item.modePaiement] }} />
                      {MODE_PAIEMENT_LABELS[item.modePaiement]}
                    </span>
                    <span className="font-mono font-semibold text-[#0F4A0F]">{item.count} ({item.share}%)</span>
                  </div>
                ))}
                <div className="mt-4 rounded-[12px] bg-[#FEFCE8] border border-[#F5C400]/30 px-3 py-2 text-xs text-[#7A5C00]">
                  Plus utilise: <strong>{stats?.mostUsedPaymentMode ? MODE_PAIEMENT_LABELS[stats.mostUsedPaymentMode.modePaiement] : '-'}</strong>
                </div>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Panel title="Plus grands contributeurs">
          {(stats?.topContributors?.length ?? 0) === 0 ? (
            <EmptyMini icon={<Crown size={20} />} text="Aucun contributeur confirme" />
          ) : (
            <div className="space-y-3">
              {(stats?.topContributors ?? []).map((item, index) => (
                <button key={item.membreId} onClick={() => setActiveView('contributions')}
                  className="w-full flex items-center gap-3 rounded-[12px] border border-gray-100 px-3 py-2.5 hover:border-[#1A6B1A]/40 hover:bg-[#F0FDF4] transition-colors text-left">
                  <span className={`w-8 h-8 rounded-[10px] flex items-center justify-center font-bold text-xs ${index === 0 ? 'bg-[#F5C400] text-[#0F4A0F]' : 'bg-gray-100 text-gray-600'}`}>
                    {index + 1}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-gray-800 truncate">{item.fullName}</span>
                    <span className="block text-xs text-gray-400">{item.count} contribution(s)</span>
                  </span>
                  <span className="font-mono font-bold text-[#1A6B1A]">{formatAmount(item.total)}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Taux par rubrique">
          {(stats?.contributionRates?.length ?? 0) === 0 ? (
            <EmptyMini icon={<FolderOpen size={20} />} text="Aucune rubrique avec collecte" />
          ) : (
            <div className="space-y-3">
              {(stats?.contributionRates ?? []).map(item => {
                const rate = item.rate ?? 0
                return (
                  <button key={item.rubriqueId} onClick={() => setActiveView('rubriques')} className="w-full text-left">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-gray-700 truncate">{item.code}</span>
                      <span className="text-xs font-mono text-gray-500">{item.rate == null ? 'Libre' : `${item.rate}%`}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, rate)}%`, background: rate >= 80 ? '#1A6B1A' : rate >= 50 ? '#F5C400' : '#EF4444' }} />
                    </div>
                    <div className="flex justify-between mt-1 text-[10px] text-gray-400">
                      <span>{formatAmount(item.total)}</span>
                      <span>{item.count} paiement(s)</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </Panel>

        <Panel title="Actions rapides">
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: Users, label: 'Membre', view: 'membres', color: '#2563EB' },
              { icon: CreditCard, label: 'Paiement', view: 'contributions', color: '#1A6B1A' },
              { icon: CheckCircle2, label: 'Validation', view: 'validations', color: '#F59E0B' },
              { icon: FileText, label: 'Rapport', view: 'rapports', color: '#7C3AED' },
            ].map(action => (
              <button key={action.label} onClick={() => setActiveView(action.view)}
                className="rounded-[12px] border border-gray-100 bg-white px-3 py-4 text-center hover:-translate-y-0.5 hover:shadow-cem transition-all">
                <action.icon size={20} className="mx-auto mb-2" style={{ color: action.color }} />
                <span className="text-xs font-semibold text-gray-600">{action.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-[14px] bg-[#0F4A0F] px-4 py-3 text-white">
            <p className="text-xs text-white/60">Grand contributeur</p>
            <p className="font-display text-lg font-semibold truncate">{stats?.topContributor?.fullName ?? 'Aucun pour le moment'}</p>
            <p className="font-mono text-sm text-[#F5C400]">{formatAmount(stats?.topContributor?.total ?? 0)}</p>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-[18px] border border-gray-100 p-5 shadow-[0_8px_24px_rgba(15,74,15,0.04)]">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-display font-semibold text-[#0F4A0F] text-lg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function MetricCard({ icon, title, value, tone, onClick }: {
  icon: React.ReactNode
  title: string
  value: string
  tone: 'green' | 'yellow' | 'blue' | 'red'
  onClick: () => void
}) {
  const colors = {
    green: ['#E8F5E8', '#1A6B1A'],
    yellow: ['#FEFCE8', '#C4A000'],
    blue: ['#EFF6FF', '#2563EB'],
    red: ['#FEF2F2', '#DC2626'],
  }[tone]

  return (
    <button onClick={onClick} className="bg-white rounded-[18px] border border-gray-100 p-4 text-left hover:-translate-y-1 hover:shadow-cem-lg transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-[12px] flex items-center justify-center" style={{ background: colors[0], color: colors[1] }}>
          {icon}
        </div>
        <span className="text-[10px] font-semibold text-gray-400 uppercase">ouvrir</span>
      </div>
      <p className="font-display font-bold text-gray-900 text-2xl leading-tight">{value}</p>
      <p className="text-gray-500 text-xs mt-1">{title}</p>
    </button>
  )
}

function EmptyMini({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="h-40 flex flex-col items-center justify-center gap-2 text-gray-400 text-sm">
      {icon}
      <span>{text}</span>
    </div>
  )
}

function MoneyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey?: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  const total = payload.find(p => p.dataKey === 'total')?.value ?? 0
  const count = payload.find(p => p.dataKey === 'count')?.value ?? 0
  return (
    <div className="bg-white rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-gray-100 px-4 py-3">
      <p className="text-xs font-semibold text-gray-500 mb-1">{label}</p>
      <p className="text-sm font-bold text-[#1A6B1A]">{formatAmount(total)}</p>
      <p className="text-xs text-gray-400">{count} contribution(s)</p>
    </div>
  )
}

function RateTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-gray-100 px-4 py-3">
      <p className="text-xs font-semibold text-gray-500 mb-1">{label}</p>
      <p className="text-sm font-bold text-[#1A6B1A]">{payload[0].value}% confirme</p>
    </div>
  )
}

function ModeTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { modePaiement: ModePaiement; count: number; total: number; share: number } }> }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload
  return (
    <div className="bg-white rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-gray-100 px-4 py-3">
      <p className="text-xs font-semibold text-gray-500 mb-1">{MODE_PAIEMENT_LABELS[item.modePaiement]}</p>
      <p className="text-sm font-bold text-[#1A6B1A]">{item.count} contribution(s)</p>
      <p className="text-xs text-gray-400">{formatAmount(item.total)} - {item.share}%</p>
    </div>
  )
}
