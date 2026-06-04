'use client'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, CreditCard, Users, Wallet } from 'lucide-react'
import api from '@/lib/api'
import { formatAmount } from '@/lib/utils'
import { SkeletonCard } from '@/components/ui/Skeleton'
import type { DashboardStats } from '@/types'

interface MonthlyStat {
  month: number
  label: string
  total: number
  count: number
}

export function Statistiques() {
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => (await api.get('/stats/dashboard')).data.data,
  })

  const { data: monthly, isLoading: monthlyLoading } = useQuery<MonthlyStat[]>({
    queryKey: ['monthly-stats'],
    queryFn: async () => (await api.get('/stats/monthly')).data.data,
  })

  const bestMonth = monthly?.reduce<MonthlyStat | null>((best, item) => !best || item.total > best.total ? item : best, null)

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="mb-6">
        <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">Statistiques</h2>
        <p className="text-gray-500 text-sm">Vue financiere et operationnelle du ministere</p>
      </div>

      {statsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-5">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-5">
          <Kpi icon={<Users size={18} />} label="Membres actifs" value={String(stats?.totalMembres ?? 0)} />
          <Kpi icon={<Wallet size={18} />} label="Collecte annuelle" value={formatAmount(stats?.totalCollectedYear ?? 0)} />
          <Kpi icon={<CreditCard size={18} />} label="Ce mois" value={formatAmount(stats?.totalCollectedMonth ?? 0)} />
          <Kpi icon={<BarChart3 size={18} />} label="Meilleur mois" value={bestMonth ? formatAmount(bestMonth.total) : formatAmount(0)} />
        </div>
      )}

      <div className="bg-white rounded-[18px] border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-semibold text-gray-800">Collectes mensuelles</h3>
          <span className="text-xs text-gray-400">{new Date().getFullYear()}</span>
        </div>
        {monthlyLoading ? (
          <div className="h-72 skeleton rounded-[12px]" />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthly ?? []} barSize={28}>
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis hide />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(26,107,26,0.05)' }} />
              <Bar dataKey="total" radius={[8, 8, 0, 0]}>
                {(monthly ?? []).map((entry) => (
                  <Cell
                    key={entry.month}
                    fill={entry.month === new Date().getMonth() + 1 ? '#F5C400' : '#1A6B1A'}
                    fillOpacity={entry.total > 0 ? 0.9 : 0.25}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-[18px] border border-gray-100 p-4">
      <div className="w-9 h-9 rounded-[10px] bg-[#E8F5E8] text-[#1A6B1A] flex items-center justify-center mb-3">
        {icon}
      </div>
      <p className="font-display font-bold text-[#0F4A0F] text-2xl leading-tight">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  )
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-gray-100 px-4 py-3">
      <p className="text-xs font-semibold text-gray-500 mb-1">{label}</p>
      <p className="text-sm font-bold text-[#1A6B1A]">{formatAmount(payload[0]?.value)}</p>
    </div>
  )
}
