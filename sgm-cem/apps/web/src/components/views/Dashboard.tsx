'use client'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle, BarChart3, CheckCircle2, CreditCard, Crown,
  FileText, FolderOpen, TrendingUp, Users, Wallet, Clock,
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import api from '@/lib/api'
import { formatAmount, formatDateTime, getInitials, MODE_PAIEMENT_LABELS, ROLE_LEVELS } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { SkeletonCard } from '@/components/ui/Skeleton'
import { useAnimatedCounter } from '@/hooks/useAnimatedCounter'
import type { Contribution, DashboardStats, ModePaiement } from '@/types'

interface MonthlyStat {
  month: number; label: string; total: number; count: number
  pending: number; litiges: number; confirmationRate: number
}

const MODE_COLORS: Record<ModePaiement, string> = {
  ESPECES: '#16A34A', MTN_MOMO: '#F5C400', ORANGE_MONEY: '#F97316', YELII: '#7E22CE',
  CARTE_VISA: '#2563EB', VIREMENT: '#7C3AED',
}

// ─── Welcome banner ────────────────────────────────────────────────────
function WelcomeBanner({ user, stats, isLoading }: {
  user: { firstName: string; role: string } | null
  stats?: DashboardStats
  isLoading: boolean
}) {
  const canSeeFinancials = ROLE_LEVELS[user?.role ?? ''] >= 3

  return (
    <div className="relative overflow-hidden rounded-[20px] cross-bg mb-1"
      style={{ background: 'linear-gradient(135deg, #052005 0%, #0F4A0F 45%, #1A6B1A 100%)' }}>
      <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, #F5C400, transparent)', opacity: 0.08 }} />
      <div className="relative z-10 p-5 md:p-6 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-center">
        <div>
          <p className="text-white/50 text-xs mb-0.5">
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <h1 className="font-display text-white text-3xl md:text-4xl font-semibold leading-tight">
            Bonjour, {user?.firstName ?? '...'}
          </h1>
          <p className="text-white/60 text-sm mt-1">
            Culte d&apos;Enfants de Melen · Tableau de bord financier
          </p>
        </div>
        {canSeeFinancials && (
          <div className="flex gap-3">
            <BannerStat label="Ce mois" value={isLoading ? '…' : formatAmount(stats?.totalCollectedMonth ?? 0)} />
            <BannerStat label="Cette année" value={isLoading ? '…' : formatAmount(stats?.totalCollectedYear ?? 0)} highlight />
          </div>
        )}
      </div>
    </div>
  )
}

function BannerStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-[14px] px-4 py-3 text-center min-w-[130px]"
      style={{ background: highlight ? 'rgba(245,196,0,0.15)' : 'rgba(255,255,255,0.08)' }}>
      <p className="text-[11px] text-white/60 mb-0.5">{label}</p>
      <p className={`font-display font-bold text-lg leading-tight ${highlight ? 'text-[#F5C400]' : 'text-white'}`}>{value}</p>
    </div>
  )
}

// ─── Animated KPI card ─────────────────────────────────────────────────
function MetricCard({ icon, title, rawValue, displayValue, tone, onClick }: {
  icon: React.ReactNode; title: string; rawValue: number; displayValue?: string
  tone: 'green' | 'yellow' | 'blue' | 'red'; onClick: () => void
}) {
  const animatedRaw = useAnimatedCounter(rawValue)
  const colors = {
    green:  { bg: '#E8F5E8', fg: '#1A6B1A', accent: '#1A6B1A' },
    yellow: { bg: '#FEFCE8', fg: '#C4A000', accent: '#F5C400' },
    blue:   { bg: '#EFF6FF', fg: '#2563EB', accent: '#2563EB' },
    red:    { bg: '#FEF2F2', fg: '#DC2626', accent: '#DC2626' },
  }[tone]

  const shown = displayValue ?? String(animatedRaw)

  return (
    <button
      onClick={onClick}
      className="bg-white rounded-[18px] border border-gray-100 p-4 text-left hover:-translate-y-1 hover:shadow-cem-lg transition-all group relative overflow-hidden"
    >
      <div className="absolute top-0 left-0 right-0 h-1 rounded-t-[18px]"
        style={{ background: `linear-gradient(90deg, ${colors.accent}, ${colors.fg})` }} />
      <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-5"
        style={{ background: colors.accent }} />
      <div className="flex items-start justify-between mb-3 mt-1">
        <div className="w-10 h-10 rounded-[12px] flex items-center justify-center"
          style={{ background: colors.bg, color: colors.fg }}>
          {icon}
        </div>
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide group-hover:text-[#1A6B1A] transition-colors">ouvrir →</span>
      </div>
      <p className="font-display font-bold text-gray-900 text-2xl leading-tight">{shown}</p>
      <p className="text-gray-500 text-xs mt-1">{title}</p>
    </button>
  )
}

// ─── Recent activity timeline ──────────────────────────────────────────
  const MODE_EMOJI: Record<ModePaiement, string> = {
    ESPECES: '₣', MTN_MOMO: 'M', ORANGE_MONEY: 'O', YELII: 'Y', CARTE_VISA: '▪', VIREMENT: '⇌',
  }

  const MODE_BG: Record<ModePaiement, string> = {
    ESPECES: '#E8F5E8', MTN_MOMO: '#FEFCE8', ORANGE_MONEY: '#FFF7ED', YELII: '#F5F3FF',
    CARTE_VISA: '#EFF6FF', VIREMENT: '#EEF2FF',
  }
  const STATUS_DOT: Record<string, string> = {
  CONFIRME: '#1A6B1A', EN_ATTENTE_CONFIRMATION: '#F5C400', LITIGE: '#DC2626', ANNULE: '#94A3B8',
}

function ActivityTimeline({ items }: { items: Contribution[] }) {
  if (!items.length) return (
    <div className="py-8 text-center text-gray-400 text-sm">Aucune contribution récente</div>
  )
  return (
    <div className="space-y-2">
      {items.slice(0, 8).map(c => (
        <div key={c.id}
          className="flex items-center gap-3 rounded-[12px] px-3 py-2.5 hover:bg-[#F0FDF4] transition-colors cursor-default">
          <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-base flex-shrink-0"
            style={{ background: MODE_BG[c.modePaiement] }}>
            {MODE_EMOJI[c.modePaiement]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{c.membre?.user.fullName ?? '—'}</p>
            <p className="text-xs text-gray-400 truncate">{c.rubrique?.code} · {formatDateTime(c.createdAt)}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-mono font-bold text-sm text-[#1A6B1A]">{formatAmount(c.montant)}</p>
            <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_DOT[c.statut] ?? '#94A3B8' }} />
              {c.statut === 'CONFIRME' ? 'Confirmé' : c.statut === 'EN_ATTENTE_CONFIRMATION' ? 'En attente' : c.statut === 'LITIGE' ? 'Litige' : 'Annulé'}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────
export function Dashboard() {
  const { setActiveView } = useAppStore()
  const { user } = useAuthStore()
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
    <div className="p-4 md:p-6 space-y-5 animate-page-enter pb-20 lg:pb-6">

      {/* Welcome banner */}
      <WelcomeBanner user={user} stats={stats} isLoading={isLoading} />

      {/* Year selector row */}
      <div className="flex items-center justify-between gap-3 bg-white rounded-[14px] border border-gray-100 px-4 py-2.5">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Exercice financier</span>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setYear(y => y - 1)} className="w-7 h-7 flex items-center justify-center rounded-[8px] border border-gray-200 text-sm hover:bg-gray-50 transition-colors">‹</button>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="px-3 py-1.5 rounded-[8px] border border-gray-200 text-sm font-semibold bg-white focus:outline-none">
            {[year - 2, year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => setYear(y => y + 1)} className="w-7 h-7 flex items-center justify-center rounded-[8px] border border-gray-200 text-sm hover:bg-gray-50 transition-colors">›</button>
        </div>
      </div>

      {/* KPI cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 stagger-children">
          <MetricCard
            icon={<Wallet size={18} />} title="Collecte annuelle"
            rawValue={stats?.totalCollectedYear ?? 0}
            displayValue={formatAmount(stats?.totalCollectedYear ?? 0)}
            tone="green" onClick={() => setActiveView('contributions')}
          />
          <MetricCard
            icon={<TrendingUp size={18} />} title="Ce mois-ci"
            rawValue={stats?.totalCollectedMonth ?? 0}
            displayValue={formatAmount(stats?.totalCollectedMonth ?? 0)}
            tone="yellow" onClick={() => setActiveView('statistiques')}
          />
          <MetricCard
            icon={<CheckCircle2 size={18} />} title="Taux confirmation"
            rawValue={stats?.globalConfirmationRate ?? 0}
            displayValue={`${stats?.globalConfirmationRate ?? 0}%`}
            tone="blue" onClick={() => setActiveView('validations')}
          />
          <MetricCard
            icon={<AlertTriangle size={18} />} title="Litiges actifs"
            rawValue={stats?.litiges ?? 0}
            tone="red" onClick={() => setActiveView('litiges')}
          />
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-5">
        <Panel
          title="Collectes mensuelles"
          action={(
            <div className="flex rounded-[10px] border border-gray-200 overflow-hidden text-xs">
              <button onClick={() => setChartMode('montants')} className={`px-3 py-1.5 transition-colors ${chartMode === 'montants' ? 'bg-[#1A6B1A] text-white' : 'bg-white text-gray-500'}`}>Montants</button>
              <button onClick={() => setChartMode('taux')} className={`px-3 py-1.5 transition-colors ${chartMode === 'taux' ? 'bg-[#1A6B1A] text-white' : 'bg-white text-gray-500'}`}>Taux</button>
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
                <Area type="monotone" dataKey="total" stroke="#1A6B1A" strokeWidth={2.5} fill="url(#amountFill)" />
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
                    <Cell key={item.month}
                      fill={item.confirmationRate >= 80 ? '#1A6B1A' : item.confirmationRate >= 50 ? '#F59E0B' : '#DC2626'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="mt-3 flex items-center justify-between text-xs text-gray-500 border-t border-gray-50 pt-3">
            <span>Total graphe : <strong className="text-[#0F4A0F] font-mono">{formatAmount(monthlyTotal)}</strong></span>
            <span>{stats?.totalConfirmedContributions ?? 0} contribution(s) confirmée(s)</span>
          </div>
        </Panel>

        <Panel title="Répartition des paiements">
          {(stats?.modePaiementStats?.length ?? 0) === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center gap-2 text-gray-400 text-sm">
              <CreditCard size={20} />
              <span>Aucune contribution confirmée</span>
            </div>
          ) : (
            <div className="space-y-3">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={stats?.modePaiementStats ?? []} dataKey="count" nameKey="modePaiement"
                    innerRadius={48} outerRadius={76} paddingAngle={3}>
                    {(stats?.modePaiementStats ?? []).map(item => (
                      <Cell key={item.modePaiement} fill={MODE_COLORS[item.modePaiement]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ModeTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              {(stats?.modePaiementStats ?? []).map(item => (
                <div key={item.modePaiement} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-gray-600">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: MODE_COLORS[item.modePaiement] }} />
                    {MODE_PAIEMENT_LABELS[item.modePaiement]}
                  </span>
                  <span className="font-mono font-semibold text-[#0F4A0F]">{item.count} ({item.share}%)</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Top contributors */}
        <Panel title="Top contributeurs">
          {(stats?.topContributors?.length ?? 0) === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center gap-2 text-gray-400 text-sm">
              <Crown size={20} />
              <span>Aucun contributeur confirmé</span>
            </div>
          ) : (
            <div className="space-y-2">
              {(stats?.topContributors ?? []).map((item, index) => (
                <button key={item.membreId} onClick={() => setActiveView('contributions')}
                  className="w-full flex items-center gap-3 rounded-[12px] border border-gray-100 px-3 py-2.5 hover:border-[#1A6B1A]/40 hover:bg-[#F0FDF4] transition-colors text-left">
                  <span className={`w-8 h-8 rounded-[10px] flex items-center justify-center font-bold text-xs ${index === 0 ? 'bg-[#F5C400] text-[#0F4A0F]' : 'bg-gray-100 text-gray-600'}`}>
                    {index + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="w-6 h-6 rounded-[6px] bg-[#E8F5E8] text-[#1A6B1A] text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                        {getInitials(item.fullName)}
                      </span>
                      <span className="text-sm font-semibold text-gray-800 truncate">{item.fullName}</span>
                    </div>
                    <span className="text-xs text-gray-400">{item.count} contribution(s)</span>
                  </div>
                  <span className="font-mono font-bold text-sm text-[#1A6B1A] shrink-0">{formatAmount(item.total)}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>

        {/* Taux par rubrique */}
        <Panel title="Taux par rubrique">
          {(stats?.contributionRates?.length ?? 0) === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center gap-2 text-gray-400 text-sm">
              <FolderOpen size={20} />
              <span>Aucune rubrique active</span>
            </div>
          ) : (
            <div className="space-y-3">
              {(stats?.contributionRates ?? []).map(item => {
                const rate = item.rate ?? 0
                return (
                  <button key={item.rubriqueId} onClick={() => setActiveView('rubriques')} className="w-full text-left">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-gray-700 truncate max-w-[140px]">{item.code}</span>
                      <span className="text-xs font-mono text-gray-500">{item.rate == null ? 'Libre' : `${item.rate}%`}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${Math.min(100, rate)}%`, background: rate >= 80 ? '#1A6B1A' : rate >= 50 ? '#F5C400' : '#EF4444' }} />
                    </div>
                    <div className="flex justify-between mt-0.5 text-[10px] text-gray-400">
                      <span>{formatAmount(item.total)}</span>
                      <span>{item.count} paiement(s)</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </Panel>

        {/* Actions rapides + activité */}
        <div className="space-y-4">
          <Panel title="Actions rapides">
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: Users,        label: 'Nouveau membre',   view: 'membres',       color: '#2563EB', bg: '#EFF6FF' },
                { icon: CreditCard,   label: 'Enreg. paiement',  view: 'contributions', color: '#1A6B1A', bg: '#E8F5E8' },
                { icon: CheckCircle2, label: 'Valider',          view: 'validations',   color: '#F59E0B', bg: '#FEFCE8' },
                { icon: FileText,     label: 'Rapport',          view: 'rapports',      color: '#7C3AED', bg: '#F5F3FF' },
              ].map(action => (
                <button key={action.label} onClick={() => setActiveView(action.view)}
                  className="rounded-[12px] border border-gray-100 bg-white px-3 py-3.5 text-center hover:-translate-y-0.5 hover:shadow-cem transition-all group">
                  <div className="w-8 h-8 rounded-[10px] flex items-center justify-center mx-auto mb-2 transition-transform group-hover:scale-110"
                    style={{ background: action.bg, color: action.color }}>
                    <action.icon size={16} />
                  </div>
                  <span className="text-[11px] font-semibold text-gray-600">{action.label}</span>
                </button>
              ))}
            </div>
          </Panel>

          {/* Grand contributeur */}
          <div className="rounded-[14px] bg-[#0F4A0F] px-4 py-3.5 text-white">
            <div className="flex items-center gap-2 mb-1">
              <Crown size={14} className="text-[#F5C400]" />
              <p className="text-xs text-white/60">Grand contributeur {year}</p>
            </div>
            <p className="font-display text-xl font-semibold truncate">{stats?.topContributor?.fullName ?? '—'}</p>
            <p className="font-mono text-sm text-[#F5C400]">{formatAmount(stats?.topContributor?.total ?? 0)}</p>
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <Panel
        title="Activité récente"
        action={<button onClick={() => setActiveView('contributions')} className="text-xs text-[#1A6B1A] font-semibold hover:underline">Voir tout →</button>}
      >
        {isLoading ? (
          <div className="h-40 skeleton rounded-[12px]" />
        ) : (
          <ActivityTimeline items={stats?.recentContributions ?? []} />
        )}
      </Panel>

    </div>
  )
}

// ─── Panel wrapper ────────────────────────────────────────────────────
function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-[18px] border border-gray-100 p-5 shadow-[0_2px_12px_rgba(15,74,15,0.04)]">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-display font-semibold text-[#0F4A0F] text-lg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

// ─── Tooltips ─────────────────────────────────────────────────────────
function MoneyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey?: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  const total = payload.find(p => p.dataKey === 'total')?.value ?? payload[0]?.value ?? 0
  return (
    <div className="bg-white rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-gray-100 px-4 py-3">
      <p className="text-xs font-semibold text-gray-500 mb-1">{label}</p>
      <p className="text-sm font-bold text-[#1A6B1A]">{formatAmount(total)}</p>
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
function ModeTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { modePaiement: ModePaiement; count: number; total: number; share: number } }> }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload
  return (
    <div className="bg-white rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-gray-100 px-4 py-3">
      <p className="text-xs font-semibold text-gray-500 mb-1">{MODE_PAIEMENT_LABELS[item.modePaiement]}</p>
      <p className="text-sm font-bold text-[#1A6B1A]">{item.count} contribution(s)</p>
      <p className="text-xs text-gray-400">{formatAmount(item.total)} — {item.share}%</p>
    </div>
  )
}
