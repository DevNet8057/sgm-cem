'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Empty, Progress, Segmented, Select, Skeleton, Tag } from 'antd'
import { motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle, CheckCircle2, CreditCard, Crown, FileText, FolderOpen,
  Target, TrendingUp, Users, Wallet,
} from 'lucide-react'
import CountUp from 'react-countup'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import api from '@/lib/api'
import { ActivityCard } from '@/components/ui/ActivityCard'
import { Avatar } from '@/components/ui/Avatar'
import { canAccessView, type ViewId } from '@/config/navigation'
import { formatAmount, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import type { Contribution, DashboardStats, ModePaiement } from '@/types'

interface MonthlyStat {
  month: number; label: string; total: number; count: number
  pending: number; litiges: number; confirmationRate: number
}

const MODE_COLORS: Record<ModePaiement, string> = {
  ESPECES: '#2ECC71', MTN_MOMO: '#F5C400', ORANGE_MONEY: '#F97316', YELII: '#7E22CE',
  CARTE_VISA: '#2563EB', VIREMENT: '#7C3AED',
}

const STATUS_COLORS: Record<string, string> = {
  CONFIRME: 'success', EN_ATTENTE_CONFIRMATION: 'warning', LITIGE: 'error', ANNULE: 'error',
}

const STATUS_LABELS: Record<string, string> = {
  CONFIRME: 'Confirmé', EN_ATTENTE_CONFIRMATION: 'En attente', LITIGE: 'Litige', ANNULE: 'Annulé',
}

const RANK_BADGE_COLORS: Record<number, { background: string; color: string }> = {
  0: { background: '#F5C400', color: '#052005' },
  1: { background: '#CBD5E1', color: '#334155' },
  2: { background: '#D9A066', color: '#FFFFFF' },
}

export function Dashboard() {
  const { setActiveView } = useAppStore()
  const { user } = useAuthStore()
  const reduceMotion = useReducedMotion()
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [chartMode, setChartMode] = useState<'montants' | 'nombre'>('montants')

  const statsQuery = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats', year],
    queryFn: async () => (await api.get('/stats/dashboard', { params: { year } })).data.data,
    refetchInterval: 30000,
  })
  const monthlyQuery = useQuery<MonthlyStat[]>({
    queryKey: ['monthly-stats', year],
    queryFn: async () => (await api.get('/stats/monthly', { params: { year } })).data.data,
  })

  const stats = statsQuery.data
  const monthlyData = useMemo(() => monthlyQuery.data ?? [], [monthlyQuery.data])
  const monthlyTotal = useMemo(() => monthlyData.reduce((sum, item) => sum + item.total, 0), [monthlyData])
  const currentMonth = new Date().getMonth() + 1
  const selectedMonth = useMemo(
    () => monthlyData.find(item => item.month === currentMonth),
    [currentMonth, monthlyData]
  )
  const paymentModeData = useMemo(() => {
    const total = stats?.modePaiementStats?.reduce((sum, item) => sum + item.total, 0) ?? 0
    return (stats?.modePaiementStats ?? []).map(item => ({
      ...item,
      amountShare: total > 0 ? Math.round((item.total / total) * 100) : 0,
    }))
  }, [stats?.modePaiementStats])
  const years = Array.from({ length: 7 }, (_, index) => currentYear - 4 + index)
  const totalTarget = useMemo(
    () => (stats?.contributionRates ?? []).reduce((sum, item) => sum + (item.targetAmount ?? 0), 0),
    [stats?.contributionRates]
  )
  const targetProgress = totalTarget > 0
    ? Math.min(100, Math.round(((stats?.totalCollectedYear ?? 0) / totalTarget) * 100))
    : null
  const motionProps = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35 } }

  const momDelta = useMemo(() => {
    const previous = monthlyData.find(item => item.month === currentMonth - 1)
    if (!selectedMonth || !previous || previous.total === 0) return null
    return Math.round(((selectedMonth.total - previous.total) / previous.total) * 100)
  }, [currentMonth, monthlyData, selectedMonth])
  const openView = (preferred: ViewId, fallback: ViewId = 'contributions') => {
    if (!user) return
    setActiveView(canAccessView(user.role, preferred) ? preferred : fallback)
  }

  if (statsQuery.isError || monthlyQuery.isError) {
    return (
      <motion.div {...motionProps} className="bg-dash-bg p-4 text-dash-text md:p-6 xl:p-8">
        <Card className="mx-auto max-w-3xl rounded-dash-card border-dash-border bg-dash-card shadow-dash">
          <Alert
            showIcon
            type="error"
            message="Impossible de charger le tableau de bord"
            description="Aucune valeur financière n’est affichée tant que les données ne sont pas disponibles."
            action={<Button onClick={() => { void statsQuery.refetch(); void monthlyQuery.refetch() }}>Réessayer</Button>}
          />
        </Card>
      </motion.div>
    )
  }

  return (
      <motion.div {...motionProps} className="space-y-8 bg-dash-bg p-4 pb-20 text-dash-text md:p-6 xl:p-8 lg:pb-8">
        <Card
          variant="borderless"
          className="overflow-hidden rounded-dash-card shadow-dash"
          styles={{ body: { background: 'radial-gradient(circle at 85% 0%, rgba(46,204,113,.14), transparent 24rem), linear-gradient(to bottom right, var(--dash-card), var(--dash-sidebar))' } }}
        >
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="mb-1 text-xs capitalize text-dash-textMuted">
                {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
              <h1 className="font-dash text-4xl font-bold leading-tight text-dash-text md:text-[48px]">Bonjour, {user?.firstName ?? '…'} 👋</h1>
              <p className="mt-2 text-[15px] text-dash-textMuted">Voici la situation financière de votre organisation aujourd&apos;hui.</p>
            </div>
            <div className="min-w-32">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dash-textMuted" htmlFor="dashboard-year">Exercice</label>
              <Select id="dashboard-year" value={year} onChange={setYear} options={years.map(value => ({ value, label: String(value) }))} className="w-full" aria-label="Exercice financier" />
            </div>
          </div>
        </Card>

        {statsQuery.isLoading ? <DashboardSkeleton /> : (
          <div className="stagger-children grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={<TrendingUp size={20} />} tone="success"
              title={`${new Date(year, currentMonth - 1).toLocaleDateString('fr-FR', { month: 'long' })} ${year}`}
              value={selectedMonth?.total ?? 0} isAmount
              contextNode={momDelta === null ? undefined : (
                <span className={momDelta >= 0 ? 'text-dash-success' : 'text-dash-danger'}>
                  {momDelta >= 0 ? '+' : ''}{momDelta} % vs mois précédent
                </span>
              )}
              footer={<SparklineMini data={monthlyData} color="#22C55E" gradientId="kpi-mois" />}
              onClick={() => openView('statistiques')}
            />
            <KpiCard
              icon={<Wallet size={20} />} tone="primary" title="Collecte annuelle"
              value={stats?.totalCollectedYear ?? 0} isAmount
              contextNode={totalTarget > 0
                ? `Objectif : ${formatAmount(totalTarget)}`
                : `${stats?.totalConfirmedContributions ?? 0} contribution(s) confirmée(s) en ${year}`}
              footer={totalTarget > 0 ? (
                <div className="flex items-center gap-3">
                  <Progress
                    type="circle" size={44} showInfo={false}
                    percent={targetProgress ?? 0}
                    strokeColor={(targetProgress ?? 0) >= 80 ? '#22C55E' : (targetProgress ?? 0) >= 50 ? '#FACC15' : '#EF4444'}
                  />
                  <span className="text-[13px] font-semibold text-dash-text">{targetProgress} %</span>
                </div>
              ) : <SparklineMini data={monthlyData} color="#2ECC71" gradientId="kpi-annuel" />}
              onClick={() => openView('contributions')}
            />
            <KpiCard
              icon={<CheckCircle2 size={20} />} tone="warning" title="Taux de confirmation"
              value={stats?.globalConfirmationRate ?? 0} suffix=" %"
              footer={
                <Progress
                  type="circle" size={44} showInfo={false}
                  percent={stats?.globalConfirmationRate ?? 0}
                  strokeColor={(stats?.globalConfirmationRate ?? 0) >= 80 ? '#22C55E' : (stats?.globalConfirmationRate ?? 0) >= 50 ? '#FACC15' : '#EF4444'}
                />
              }
              onClick={() => openView('validations')}
            />
            <KpiCard
              icon={<AlertTriangle size={20} />} tone="danger" title="Litiges actifs"
              value={stats?.litiges ?? 0} pulse={(stats?.litiges ?? 0) > 0}
              footer={
                <span className="flex items-center gap-1.5 text-[13px] text-dash-textMuted">
                  <span className={`h-2 w-2 rounded-full ${(stats?.litiges ?? 0) > 0 ? 'bg-dash-danger' : 'bg-dash-success'}`} />
                  {(stats?.litiges ?? 0) > 0 ? `${stats?.litiges} litige(s) en cours` : 'Aucun litige en cours'}
                </span>
              }
              onClick={() => openView('litiges')}
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
          <Panel title="Collectes mensuelles">
            <Segmented block className="mb-4 sm:w-auto" value={chartMode} onChange={value => setChartMode(value as 'montants' | 'nombre')} options={[{ label: 'Montants', value: 'montants' }, { label: 'Nombre de contributions', value: 'nombre' }]} />
            {monthlyQuery.isLoading ? <Skeleton active paragraph={{ rows: 7 }} /> : monthlyData.length === 0 ? <Empty description="Aucune donnée mensuelle pour cet exercice" /> : (
              <>
                <ResponsiveContainer width="100%" height={240}>
                  {chartMode === 'montants' ? (
                    <AreaChart data={monthlyData}>
                      <defs><linearGradient id="amountFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2ECC71" stopOpacity={0.3} /><stop offset="100%" stopColor="#2ECC71" stopOpacity={0.02} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--dash-border)" /><XAxis dataKey="label" interval={1} tick={{ fontSize: 11, fill: 'var(--dash-text-muted)' }} axisLine={false} tickLine={false} /><YAxis hide /><Tooltip content={<MoneyTooltip />} /><Area type="monotone" dataKey="total" stroke="#2ECC71" strokeWidth={3} fill="url(#amountFill)" isAnimationActive={!reduceMotion} animationDuration={900} />
                    </AreaChart>
                  ) : (
                    <BarChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--dash-border)" /><XAxis dataKey="label" interval={1} tick={{ fontSize: 11, fill: 'var(--dash-text-muted)' }} axisLine={false} tickLine={false} /><YAxis hide /><Tooltip content={<CountTooltip />} />
                      <Bar dataKey="count" fill="#2ECC71" radius={[8, 8, 0, 0]} isAnimationActive={!reduceMotion} animationDuration={900} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
                <div aria-live="polite" className="mt-3 flex flex-wrap justify-between gap-2 border-t border-dash-border pt-3 text-xs text-dash-textMuted"><span>Total {year} : <strong className="text-dash-primary">{formatAmount(monthlyTotal)}</strong></span><span>{stats?.totalConfirmedContributions ?? 0} contribution(s) confirmée(s)</span></div>
              </>
            )}
          </Panel>

          <Panel title="Répartition des paiements">
            {paymentModeData.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucune contribution confirmée" /> : (
              <div>
                <div className="relative">
                  <ResponsiveContainer width="100%" height={220}><PieChart><Pie data={paymentModeData} dataKey="total" nameKey="modePaiement" innerRadius={62} outerRadius={94} paddingAngle={3} isAnimationActive={!reduceMotion} animationDuration={900}>{paymentModeData.map(item => <Cell key={item.modePaiement} fill={MODE_COLORS[item.modePaiement]} />)}</Pie><Tooltip content={<ModeTooltip />} /></PieChart></ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[11px] text-dash-textMuted">Total confirmé</span>
                    <span className="max-w-[7rem] truncate text-center text-base font-bold text-dash-text">
                      {formatCompactAmount(paymentModeData.reduce((sum, item) => sum + item.total, 0))}
                    </span>
                    <span className="text-[10px] text-dash-textMuted">FCFA</span>
                  </div>
                </div>
                <div className="space-y-2">{paymentModeData.slice(0, 4).map(item => <div key={item.modePaiement} className="flex items-center justify-between gap-3 text-sm"><span className="flex min-w-0 items-center gap-2 truncate text-dash-textMuted"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: MODE_COLORS[item.modePaiement] }} />{MODE_PAIEMENT_LABELS[item.modePaiement]}</span><strong className="shrink-0 text-dash-text">{formatCompactAmount(item.total)} · {item.amountShare} %</strong></div>)}</div>
              </div>
            )}
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Panel title="Top contributeurs">
            {(stats?.topContributors?.length ?? 0) === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucun contributeur confirmé" /> : <div className="space-y-2">{(stats?.topContributors ?? []).map((item, index) => <Button type="text" key={item.membreId} onClick={() => openView('contributions')} className="flex! h-auto! w-full! items-center! gap-3! rounded-xl! border! border-dash-border! p-3! text-left! transition hover:border-dash-primary/30! hover:bg-dash-cardHover!"><Avatar name={item.fullName} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-dash-text">{item.fullName}</span><span className="flex items-center gap-1.5 text-xs text-dash-textMuted">{RANK_BADGE_COLORS[index] && <span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: RANK_BADGE_COLORS[index].background, color: RANK_BADGE_COLORS[index].color }}>{index + 1}</span>}#{index + 1} · {item.count} contribution(s)</span></span><strong className="text-sm text-dash-primary">{formatAmount(item.total)}</strong></Button>)}</div>}
          </Panel>

          <Panel title="Contributions récentes" extra={<Button type="link" onClick={() => setActiveView('contributions')}>Voir tout</Button>}>
            {statsQuery.isLoading ? <Skeleton active /> : <ActivityTimeline items={stats?.recentContributions ?? []} />}
          </Panel>

          <Panel title="Objectif annuel">
            {totalTarget > 0 ? (
              <div className="flex h-full flex-col justify-between">
                <div>
                  <div className="mb-2 flex items-baseline justify-between text-sm">
                    <span className="text-dash-textMuted">{formatAmount(stats?.totalCollectedYear ?? 0)} / {formatAmount(totalTarget)}</span>
                    <strong className="text-dash-text">{targetProgress} %</strong>
                  </div>
                  <Progress
                    percent={targetProgress ?? 0} showInfo={false}
                    strokeColor={(targetProgress ?? 0) >= 80 ? '#22C55E' : (targetProgress ?? 0) >= 50 ? '#FACC15' : '#EF4444'}
                  />
                </div>
                <div className="mt-4 flex items-center gap-3 rounded-xl border border-dash-border bg-dash-cardHover p-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-dash-primary/15 text-dash-primary">
                    <Target size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-dash-text">Objectif atteint</p>
                    <p className="truncate text-[11px] text-dash-textMuted">À {targetProgress} % de votre objectif annuel</p>
                  </div>
                  <div className="w-16 shrink-0"><SparklineMini data={monthlyData} color="#2ECC71" gradientId="kpi-objectif" /></div>
                </div>
              </div>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucun objectif de rubrique défini" />}
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Panel title="Taux par rubrique">
            {(stats?.contributionRates?.length ?? 0) === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucune rubrique active" /> : <div className="space-y-4">{(stats?.contributionRates ?? []).map(item => <Button type="text" key={item.rubriqueId} onClick={() => openView('rubriques')} className="h-auto! w-full! px-0! text-left!"><div className="mb-1 flex justify-between text-xs"><strong className="text-dash-text">{item.code}</strong>{item.rate == null ? <span className="rounded-full bg-dash-card px-2 py-0.5 text-[11px] font-medium text-dash-textMuted">Libre</span> : <span>{item.rate} %</span>}</div>{item.rate != null && <Progress percent={Math.min(100, item.rate)} showInfo={false} strokeColor={item.rate >= 80 ? '#22C55E' : item.rate >= 50 ? '#FACC15' : '#EF4444'} />}<div className="flex justify-between text-[11px] text-dash-textMuted"><span>{formatAmount(item.total)}</span><span>{item.count} paiement(s)</span></div></Button>)}</div>}
          </Panel>
          <Panel title="Actions rapides"><div className="grid grid-cols-2 gap-2">{[
            { icon: Users, label: 'Membres', view: 'membres' }, { icon: CreditCard, label: 'Contributions', view: 'contributions' },
            { icon: CheckCircle2, label: 'Validations', view: 'validations' }, { icon: FileText, label: 'Rapports', view: 'rapports' },
          ].filter(action => user && canAccessView(user.role, action.view as ViewId)).map(action => <Button key={action.label} block className="h-auto rounded-dash-btn bg-dash-cardHover py-3" onClick={() => openView(action.view as ViewId)}><span className="flex flex-col items-center gap-1"><action.icon size={17} /><small>{action.label}</small></span></Button>)}</div></Panel>
          <Card className="flex flex-1 flex-col justify-center rounded-dash-card border-0 text-dash-text" styles={{ body: { background: 'linear-gradient(135deg, var(--dash-card), var(--dash-sidebar))' } }}><div className="flex items-center gap-2 text-xs text-dash-textMuted"><Crown size={15} className="text-dash-warning" /> Grand contributeur {year}</div><div className="mt-2 truncate text-xl font-semibold">{stats?.topContributor?.fullName ?? 'Aucun'}</div><div className="text-sm font-bold text-dash-warning">{formatAmount(stats?.topContributor?.total ?? 0)}</div></Card>
        </div>

        <Panel title="Alertes">
          <div className="flex flex-wrap gap-2">
            <AlertPill tone={(stats?.pendingConfirmations ?? 0) > 0 ? 'warning' : 'success'}>
              {(stats?.pendingConfirmations ?? 0) > 0 ? `${stats?.pendingConfirmations} contribution(s) en attente de confirmation` : 'Aucune contribution en attente'}
            </AlertPill>
            <AlertPill tone={(stats?.litiges ?? 0) > 0 ? 'danger' : 'success'}>
              {(stats?.litiges ?? 0) > 0 ? `${stats?.litiges} litige(s) en cours` : 'Aucun litige en cours'}
            </AlertPill>
            <AlertPill tone={(stats?.membresEnRetard ?? 0) > 0 ? 'warning' : 'success'}>
              {(stats?.membresEnRetard ?? 0) > 0 ? `${stats?.membresEnRetard} membre(s) en retard de contribution` : 'Aucun retard de contribution'}
            </AlertPill>
          </div>
        </Panel>

      </motion.div>
  )
}

const KPI_TONE_CLASSES: Record<'primary' | 'success' | 'warning' | 'danger', string> = {
  primary: 'bg-dash-primary/15 text-dash-primary',
  success: 'bg-dash-success/15 text-dash-success',
  warning: 'bg-dash-warning/15 text-dash-warning',
  danger:  'bg-dash-danger/15 text-dash-danger',
}

function KpiCard({
  icon, tone, title, value, isAmount, suffix, contextNode, footer, pulse, onClick,
}: {
  icon: React.ReactNode
  tone: 'primary' | 'success' | 'warning' | 'danger'
  title: string
  value: number
  isAmount?: boolean
  suffix?: string
  contextNode?: React.ReactNode
  footer?: React.ReactNode
  pulse?: boolean
  onClick: () => void
}) {
  return (
    <Card className="interactive-dash relative overflow-hidden rounded-dash-card border-dash-border bg-dash-card" styles={{ body: { padding: 20 } }}>
      <Button type="text" onClick={onClick} aria-label={`Consulter ${title}`} className="absolute! inset-0! z-10! h-full! w-full! rounded-dash-card! focus-visible:outline! focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-dash-primary!" />
      <span className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full ${KPI_TONE_CLASSES[tone]} ${pulse ? 'animate-pulse' : ''}`}>
        {icon}
      </span>
      <p className="text-[13px] font-medium uppercase tracking-wide text-dash-textMuted">{title}</p>
      <p className="mt-1 min-w-0 break-words text-[clamp(1.65rem,6vw,2.25rem)] font-bold leading-tight tracking-tight text-dash-text">
        <CountUp end={value} duration={1.2} separator=" " suffix={suffix ?? (isAmount ? ' FCFA' : '')} />
      </p>
      {contextNode && <div className="mt-1 text-[13px] text-dash-textMuted">{contextNode}</div>}
      {footer && <div className="mt-3">{footer}</div>}
    </Card>
  )
}

function SparklineMini({ data, color, gradientId }: { data: MonthlyStat[]; color: string; gradientId: string }) {
  const reduceMotion = useReducedMotion()
  if (!data.length) return null
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="total" stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} isAnimationActive={!reduceMotion} animationDuration={700} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function DashboardSkeleton() { return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Card key={index} className="border-dash-border bg-dash-card"><Skeleton active paragraph={{ rows: 2 }} /></Card>)}</div> }

function Panel({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card
      title={<span className="font-dash text-[20px] font-semibold text-dash-text">{title}</span>}
      extra={extra}
      className="h-full rounded-dash-card border-dash-border bg-dash-card shadow-dash"
    >
      {children}
    </Card>
  )
}

function ActivityTimeline({ items }: { items: Contribution[] }) {
  if (!items.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucune contribution récente" />
  return (
    <div className="stagger-children space-y-2">
      {items.slice(0, 8).map(item => (
        <ActivityCard
          key={item.id}
          avatar={<Avatar name={item.membre?.user.fullName ?? 'Membre inconnu'} size="md" />}
          title={item.membre?.user.fullName ?? 'Membre inconnu'}
          subtitle={`${item.rubrique?.code ?? ''} · ${MODE_PAIEMENT_LABELS[item.modePaiement]}`}
          timestamp={item.createdAt}
          trailing={
            <>
              <strong className="block text-sm text-dash-primary">{formatAmount(item.montant)}</strong>
              <Tag color={STATUS_COLORS[item.statut]} className="m-0">{STATUS_LABELS[item.statut] ?? item.statut}</Tag>
            </>
          }
          className="border-dash-border bg-dash-card text-dash-text hover:border-dash-primary/30 hover:bg-dash-cardHover"
        />
      ))}
    </div>
  )
}

const ALERT_TONE_CLASSES: Record<'success' | 'warning' | 'danger', string> = {
  success: 'bg-dash-success/15 text-dash-success',
  warning: 'bg-dash-warning/15 text-dash-warning',
  danger:  'bg-dash-danger/15 text-dash-danger',
}

function AlertPill({ tone, children }: { tone: 'success' | 'warning' | 'danger'; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-dash-pill px-3 py-1.5 text-[13px] font-medium ${ALERT_TONE_CLASSES[tone]}`}>
      {children}
    </span>
  )
}

function MoneyTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey?: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  const total = payload.find(item => item.dataKey === 'total')?.value ?? payload[0].value
  return <div className="rounded-xl border border-dash-border bg-dash-card px-4 py-3 shadow-dash-hover"><p className="text-xs text-dash-textMuted">{label}</p><strong className="text-sm text-dash-primary">{formatAmount(total)}</strong></div>
}

function CountTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return <div className="rounded-xl border border-dash-border bg-dash-card px-4 py-3 shadow-dash-hover"><p className="text-xs text-dash-textMuted">{label}</p><strong className="text-sm text-dash-primary">{payload[0].value} contribution(s)</strong></div>
}

function ModeTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { modePaiement: ModePaiement; count: number; total: number; amountShare: number } }> }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload
  return <div className="rounded-xl border border-dash-border bg-dash-card px-4 py-3 shadow-dash-hover"><p className="text-xs text-dash-textMuted">{MODE_PAIEMENT_LABELS[item.modePaiement]}</p><strong className="block text-sm text-dash-primary">{formatAmount(item.total)}</strong><span className="text-xs text-dash-textMuted">{item.count} contribution(s) · {item.amountShare} % du montant</span></div>
}

function formatCompactAmount(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount)
}
