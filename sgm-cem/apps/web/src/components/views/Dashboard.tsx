'use client'

import { TodoCard } from '@/components/dashboard/TodoCard'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Empty, Progress, Segmented, Skeleton, Statistic, Tag } from 'antd'
import { motion } from 'framer-motion'
import {
  AlertTriangle, CheckCircle2, CreditCard, Crown, FileText, FolderOpen,
  TrendingUp, Users, Wallet,
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import api from '@/lib/api'
import { ActivityCard } from '@/components/ui/ActivityCard'
import { Avatar } from '@/components/ui/Avatar'
import { formatAmount, MODE_PAIEMENT_LABELS, contributorName } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { useSharedPeriod } from '@/store/periodStore'
import { PeriodPicker, periodLabel } from '@/components/ui/PeriodPicker'
import { SanteCard } from '@/components/dashboard/SanteCard'
import { useAuthStore } from '@/store/authStore'
import type { CollecteursResponse, Contribution, DashboardStats, ModePaiement } from '@/types'

interface MonthlyStat {
  month: number; label: string; total: number; count: number
  pending: number; litiges: number; confirmationRate: number
}

const MODE_COLORS: Record<ModePaiement, string> = {
  ESPECES: '#16A34A', MTN_MOMO: '#F5C400', ORANGE_MONEY: '#F97316', YELII: '#7E22CE',
  CARTE_VISA: '#2563EB', VIREMENT: '#7C3AED',
}

const STATUS_COLORS: Record<string, string> = {
  CONFIRME: 'success', EN_ATTENTE_CONFIRMATION: 'warning', LITIGE: 'error', ANNULE: 'default',
}

const STATUS_LABELS: Record<string, string> = {
  CONFIRME: 'Confirmé', EN_ATTENTE_CONFIRMATION: 'En attente', LITIGE: 'Litige', ANNULE: 'Annulé',
}


export function Dashboard() {
  const { setActiveView, navigateToNotification } = useAppStore()
  const { user } = useAuthStore()
  const canSeeFundsHolders = user?.role === 'TRESORIER' || user?.role === 'ADMIN' || user?.role === 'DEVELOPER'
  const { period, setPeriod } = useSharedPeriod()
  const { year } = period
  const month = period.month ? String(period.month) : 'all'
  const [chartMode, setChartMode] = useState<'montants' | 'taux'>('montants')
  const selectedMonth = month === 'all' ? undefined : Number(month)
  const periodText = periodLabel(period)
  const trendLabel = period.month ? 'vs mois précédent' : 'vs année précédente'

  const statsQuery = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats', year, month],
    queryFn: async () => (await api.get('/stats/dashboard', { params: { year, ...(selectedMonth ? { month: selectedMonth } : {}) } })).data.data,
    refetchInterval: 30000,
  })
  const monthlyQuery = useQuery<MonthlyStat[]>({
    queryKey: ['monthly-stats', year],
    queryFn: async () => (await api.get('/stats/monthly', { params: { year } })).data.data,
  })
  const collecteursQuery = useQuery<CollecteursResponse>({
    queryKey: ['collecteurs'],
    queryFn: async () => (await api.get('/collecteurs')).data.data,
    enabled: canSeeFundsHolders,
    refetchInterval: 30000,
  })

  const stats = statsQuery.data
  const monthlyData = monthlyQuery.data ?? []
  const monthlyTotal = useMemo(() => monthlyData.reduce((sum, item) => sum + item.total, 0), [monthlyData])
  const motionProps = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35 } }

  // flex/gap plutôt que space-y (margin-based) : antd réinitialise margin-bottom
  // sur .ant-card, ce qui annule silencieusement l'espacement Tailwind entre les
  // Card/Panel du dashboard et l'élément suivant — gap sur un conteneur flex ne
  // peut pas être écrasé par la marge d'un enfant.
  return (
    <motion.div {...motionProps} className="flex flex-col gap-4 p-4 md:gap-6 md:p-6">
      <Card
        variant="borderless"
        className="overflow-hidden shadow-lg"
        styles={{ body: { background: 'linear-gradient(to bottom right, #052005, #0F4A0F 50%, #1A6B1A)' } }}
      >
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="mb-1 text-xs capitalize text-white/60">
              {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <h1 className="font-display text-3xl font-semibold text-white md:text-4xl">Bonjour, {user?.firstName ?? '…'}</h1>
            <p className="mt-1 text-sm text-white/65">Culte d&apos;Enfants de Melen · Tableau de bord financier</p>
          </div>
          <div className="w-full sm:w-[340px]">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/60">Période affichée</p>
            <PeriodPicker value={period} onChange={p => p && setPeriod(p)} tone="dark" />
          </div>
        </div>
      </Card>

      <TodoCard />

      {(user?.role === 'ADMIN' || user?.role === 'DEVELOPER') && <SanteCard />}

      {(statsQuery.isError || monthlyQuery.isError) && (
        <Alert showIcon type="error" title="Impossible de charger le tableau de bord" description="Vérifiez votre connexion puis réessayez." action={<Button size="small" onClick={() => { void statsQuery.refetch(); void monthlyQuery.refetch() }}>Réessayer</Button>} />
      )}

      {statsQuery.isLoading ? <DashboardSkeleton /> : (
        <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
          <MetricCard icon={<Wallet size={20} />} title={month === 'all' ? 'Collecte annuelle' : 'Collecte du mois'} value={stats?.totalCollectedPeriod ?? 0} formatter={formatAmount} color="#1A6B1A" onClick={() => setActiveView('contributions')} trend={{ previous: stats?.previous?.totalCollectedPeriod, kind: 'percent', label: trendLabel }} />
          <MetricCard icon={<TrendingUp size={20} />} title="Contributions confirmées" value={stats?.totalConfirmedContributions ?? 0} color="#D4A900" iconTextColor="#052005" onClick={() => setActiveView('statistiques')} trend={{ previous: stats?.previous?.totalConfirmedContributions, kind: 'percent', label: trendLabel }} />
          <MetricCard icon={<CheckCircle2 size={20} />} title="Taux de confirmation" value={stats?.globalConfirmationRate ?? 0} suffix="%" color="#2563EB" onClick={() => setActiveView('validations')} trend={{ previous: stats?.previous?.globalConfirmationRate, kind: 'points', label: trendLabel }} />
          <MetricCard icon={<AlertTriangle size={20} />} title="Litiges de la période" value={stats?.litiges ?? 0} color="#DC2626" onClick={() => setActiveView('litiges')} trend={{ previous: stats?.previous?.litiges, kind: 'percent', lowerIsBetter: true, label: trendLabel }} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-[2fr_1fr]">
        <Panel title="Collectes mensuelles">
          <Segmented block className="mb-4 sm:w-auto" value={chartMode} onChange={value => setChartMode(value as 'montants' | 'taux')} options={[{ label: 'Montants', value: 'montants' }, { label: 'Taux', value: 'taux' }]} />
          {monthlyQuery.isLoading ? <Skeleton active paragraph={{ rows: 7 }} /> : monthlyData.length === 0 ? <Empty description="Aucune donnée mensuelle pour cet exercice" /> : (
            <>
              <ResponsiveContainer width="100%" height={240}>
                {chartMode === 'montants' ? (
                  <AreaChart data={monthlyData}>
                    <defs><linearGradient id="amountFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1A6B1A" stopOpacity={0.3} /><stop offset="100%" stopColor="#1A6B1A" stopOpacity={0.02} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" /><XAxis dataKey="label" interval={1} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis hide /><Tooltip content={<MoneyTooltip />} /><Area type="monotone" dataKey="total" stroke="#1A6B1A" strokeWidth={3} fill="url(#amountFill)" />
                  </AreaChart>
                ) : (
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" /><XAxis dataKey="label" interval={1} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis hide domain={[0, 100]} /><Tooltip content={<RateTooltip />} />
                    <Bar dataKey="confirmationRate" radius={[8, 8, 0, 0]}>{monthlyData.map(item => <Cell key={item.month} fill={item.confirmationRate >= 80 ? '#1A6B1A' : item.confirmationRate >= 50 ? '#F59E0B' : '#DC2626'} />)}</Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
              <div aria-live="polite" className="mt-3 flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500"><span>Total {year} : <strong className="text-[#0F4A0F]">{formatAmount(monthlyTotal)}</strong></span><span className="first-letter:uppercase">{periodText} · {stats?.totalConfirmedContributions ?? 0} contribution(s) confirmée(s)</span></div>
            </>
          )}
        </Panel>

        <Panel title="Répartition des paiements">
          {(stats?.modePaiementStats?.length ?? 0) === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucune contribution confirmée" /> : (
            <div>
              <div aria-hidden="true" className="w-full"><ResponsiveContainer width="100%" height={190}><PieChart><Pie rootTabIndex={-1} data={stats?.modePaiementStats ?? []} dataKey="count" nameKey="modePaiement" innerRadius={50} outerRadius={78} paddingAngle={3}>{(stats?.modePaiementStats ?? []).map(item => <Cell key={item.modePaiement} fill={MODE_COLORS[item.modePaiement]} />)}</Pie><Tooltip content={<ModeTooltip />} /></PieChart></ResponsiveContainer></div>
              <div className="space-y-2">{(stats?.modePaiementStats ?? []).slice(0, 4).map(item => <div key={item.modePaiement} className="flex items-center justify-between text-sm"><span className="flex items-center gap-2 text-slate-600"><i className="h-2.5 w-2.5 rounded-full" style={{ background: MODE_COLORS[item.modePaiement] }} />{MODE_PAIEMENT_LABELS[item.modePaiement]}</span><strong className="text-[#0F4A0F]">{item.count} ({item.share} %)</strong></div>)}</div>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Activité récente" extra={<Button type="link" onClick={() => setActiveView('contributions')}>Voir tout</Button>}>
        {statsQuery.isLoading ? <Skeleton active /> : <ActivityTimeline items={stats?.recentContributions ?? []} />}
      </Panel>

      {canSeeFundsHolders && (
        <Panel title="Fonds détenus par collecteur" extra={<Button type="link" onClick={() => setActiveView('collecteurs')}>Voir tout</Button>}>
          {collecteursQuery.isLoading ? <Skeleton active paragraph={{ rows: 4 }} /> : (collecteursQuery.data?.summary?.length ?? 0) === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucun fonds détenu par un collecteur ou un responsable actuellement" />
          ) : (
            <div className="space-y-2">
              {(collecteursQuery.data?.summary ?? []).slice(0, 6).map(item => (
                <button
                  key={item.detenteurId}
                  type="button"
                  onClick={() => navigateToNotification({ targetView: 'journal', targetId: item.detenteurId })}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-100 p-3 text-left transition hover:border-green-300 hover:bg-green-50"
                >
                  <Avatar name={item.detenteurName} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">{item.detenteurName}</span>
                    <span className="block truncate text-xs text-slate-400">
                      {item.nbContributions} contribution(s){item.lastValidatedByName ? ` · validé par ${item.lastValidatedByName}` : ''}
                    </span>
                  </span>
                  <strong className="shrink-0 text-sm text-[#1A6B1A]">{formatAmount(item.totalARemettre)}</strong>
                </button>
              ))}
            </div>
          )}
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-3">
        <Panel title="Top contributeurs">
          {(stats?.topContributors?.length ?? 0) === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucun contributeur confirmé" /> : <div className="space-y-2">{(stats?.topContributors ?? []).map((item, index) => <button key={item.membreId} type="button" onClick={() => setActiveView('contributions')} className="flex w-full items-center gap-3 rounded-xl border border-slate-100 p-3 text-left transition hover:border-green-300 hover:bg-green-50"><Avatar name={item.fullName} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800">{item.fullName}</span><span className="text-xs text-slate-400">#{index + 1} · {item.count} contribution(s)</span></span><strong className="text-sm text-[#1A6B1A]">{formatAmount(item.total)}</strong></button>)}</div>}
        </Panel>

        <Panel title="Taux par rubrique">
          {(stats?.contributionRates?.length ?? 0) === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`Aucune collecte en ${periodText}`} /> : <div className="space-y-4">{(stats?.contributionRates ?? []).map(item => <button key={item.rubriqueId} onClick={() => setActiveView('rubriques')} className="w-full text-left"><div className="mb-1 flex justify-between text-xs"><strong className="text-slate-700">{item.code}</strong><span>{item.rate == null ? 'Libre' : `${item.rate} %`}</span></div><Progress aria-label={`Taux de contribution ${item.code}`} percent={Math.min(100, item.rate ?? 0)} showInfo={false} strokeColor={(item.rate ?? 0) >= 80 ? '#1A6B1A' : (item.rate ?? 0) >= 50 ? '#F5C400' : '#EF4444'} /><div className="flex justify-between text-[11px] text-slate-400"><span>{formatAmount(item.total)}</span><span>{item.count} paiement(s)</span></div></button>)}</div>}
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title="Actions rapides" fill={false}><div className="grid grid-cols-2 gap-2">{[
            { icon: Users, label: 'Nouveau membre', view: 'membres' }, { icon: CreditCard, label: 'Enregistrer', view: 'contributions' },
            { icon: CheckCircle2, label: 'Valider', view: 'validations' }, { icon: FileText, label: 'Rapport', view: 'rapports' },
          ].map(action => <Button key={action.label} block className="h-auto py-3" onClick={() => setActiveView(action.view)}><span className="flex flex-col items-center gap-1"><action.icon size={17} /><small>{action.label}</small></span></Button>)}</div></Panel>
          <Card variant="borderless" styles={{ body: { background: '#0F4A0F', color: '#fff' } }}><div className="flex items-center gap-2 text-xs text-white/60"><Crown size={15} className="text-[#F5C400]" /> Grand contributeur {year}</div><div className="mt-2 truncate text-xl font-semibold text-white">{stats?.topContributor?.fullName ?? 'Aucun'}</div><div className="text-sm font-bold text-[#F5C400]">{formatAmount(stats?.topContributor?.total ?? 0)}</div></Card>
        </div>
      </div>

    </motion.div>
  )
}

type Trend = { previous: number | undefined; kind: 'percent' | 'points'; lowerIsBetter?: boolean; label: string }

function MetricCard({ icon, title, value, suffix, formatter, color, iconTextColor, onClick, trend }: { icon: React.ReactNode; title: string; value: number; suffix?: string; formatter?: (value: number) => string; color: string; iconTextColor?: string; onClick: () => void; trend?: Trend }) {
  return <Card hoverable className="relative" styles={{ body: { padding: 18 } }}><button type="button" aria-label={`Consulter ${title}`} onClick={onClick} className="absolute inset-0 z-10 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A6B1A]" /><div className="mb-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: color, color: iconTextColor ?? '#fff' }}>{icon}</span></div><Statistic title={title} value={value} suffix={suffix} formatter={() => formatter ? formatter(value) : value} valueStyle={{ color: '#0F172A', fontWeight: 700, fontSize: 24 }} />{trend && <TrendLine value={value} trend={trend} />}</Card>
}

// Tendance par rapport à la période précédente (EF-M10-01)
function TrendLine({ value, trend }: { value: number; trend: Trend }) {
  if (trend.previous === undefined) return null
  const diff = value - trend.previous
  let text: string
  if (diff === 0) text = `= ${trend.label}`
  else if (trend.kind === 'points') text = `${diff > 0 ? '+' : '−'}${Math.abs(diff)} pt${Math.abs(diff) > 1 ? 's' : ''} ${trend.label}`
  else if (trend.previous === 0) text = `Nouveau ${trend.label}`
  else text = `${diff > 0 ? '+' : '−'}${Math.round(Math.abs(diff) / trend.previous * 100)} % ${trend.label}`
  const good = diff === 0 ? null : (diff > 0) !== !!trend.lowerIsBetter
  return <p className={`mt-1 text-xs font-semibold ${good === null ? 'text-slate-400' : good ? 'text-[#1A6B1A]' : 'text-red-600'}`}>{diff > 0 ? '▲ ' : diff < 0 ? '▼ ' : ''}{text}</p>
}

function DashboardSkeleton() { return <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Card key={index}><Skeleton active paragraph={{ rows: 2 }} /></Card>)}</div> }

// fill : la carte prend toute la hauteur de sa case de grille (cartes alignées d'une même rangée).
// À désactiver quand d'autres blocs sont empilés dans la même case, sinon ils sont repoussés hors de la grille.
function Panel({ title, extra, children, fill = true }: { title: string; extra?: React.ReactNode; children: React.ReactNode; fill?: boolean }) {
  return <Card title={<span className="font-display text-lg font-semibold text-[#0F4A0F]">{title}</span>} extra={extra} className={fill ? 'h-full shadow-sm' : 'shadow-sm'}>{children}</Card>
}

function ActivityTimeline({ items }: { items: Contribution[] }) {
  const navigateToNotification = useAppStore(s => s.navigateToNotification)
  if (!items.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucune contribution récente" />
  return (
    <div className="stagger-children space-y-2">
      {items.slice(0, 8).map(item => (
        <ActivityCard
          key={item.id}
          avatar={<Avatar name={contributorName(item)} size="md" />}
          title={contributorName(item)}
          subtitle={`${item.rubrique?.code ?? ''} · ${MODE_PAIEMENT_LABELS[item.modePaiement]}`}
          timestamp={item.createdAt}
          onClick={() => navigateToNotification({
            // En attente : direction l'écran où on peut l'action (la confirmer).
            // Déjà tranchée (confirmée/litige/annulée) : direction l'historique.
            targetView: item.statut === 'EN_ATTENTE_CONFIRMATION' ? 'validations' : 'contributions',
            targetId: item.id,
          })}
          trailing={
            <>
              <strong className="block text-sm text-[#1A6B1A]">{formatAmount(item.montant)}</strong>
              <Tag color={STATUS_COLORS[item.statut]} className="m-0">{STATUS_LABELS[item.statut] ?? item.statut}</Tag>
            </>
          }
        />
      ))}
    </div>
  )
}

function MoneyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey?: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  const total = payload.find(item => item.dataKey === 'total')?.value ?? payload[0].value
  return <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-xl"><p className="text-xs text-slate-500">{label}</p><strong className="text-sm text-[#1A6B1A]">{formatAmount(total)}</strong></div>
}

function RateTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-xl"><p className="text-xs text-slate-500">{label}</p><strong className="text-sm text-[#1A6B1A]">{payload[0].value} % confirmé</strong></div>
}

function ModeTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { modePaiement: ModePaiement; count: number; total: number; share: number } }> }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload
  return <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-xl"><p className="text-xs text-slate-500">{MODE_PAIEMENT_LABELS[item.modePaiement]}</p><strong className="block text-sm text-[#1A6B1A]">{item.count} contribution(s)</strong><span className="text-xs text-slate-400">{formatAmount(item.total)} · {item.share} %</span></div>
}
