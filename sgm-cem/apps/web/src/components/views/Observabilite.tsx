'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, CheckCircle2, Clock3, RefreshCw, Users } from 'lucide-react'
import api from '@/lib/api'
import { SkeletonCard } from '@/components/ui/Skeleton'
import type { ActivityOverview, ActivityPaginated, ActivityUserRow } from '@sgm-cem/shared'

const fmt = (n: number) => n.toLocaleString('fr-FR')
const duration = (s: number) => `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
const date = (v: string | null) => v ? new Date(v).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'Jamais'

export function Observabilite() {
  const [days, setDays] = useState<7 | 30 | 90>(7)
  const overview = useQuery<ActivityOverview>({ queryKey: ['activity-overview', days], queryFn: async () => (await api.get('/activity/overview', { params: { days } })).data.data, refetchInterval: 30000 })
  const users = useQuery<ActivityPaginated<ActivityUserRow>>({ queryKey: ['activity-users', days], queryFn: async () => (await api.get('/activity/users', { params: { days, page: 1, limit: 8 } })).data.data, refetchInterval: 30000 })
  const d = overview.data
  const cards = d ? [['En ligne maintenant', d.presence.onlineUsers, Activity], ['Comptes actifs', d.presence.activeAccounts, Users], ['Temps actif', duration(d.sessions.activeSeconds), Clock3], ['Actions auditées', d.actions.total, CheckCircle2]] as const : []
  return <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-[#1A6B1A]">Administration</p><h2 className="font-display text-2xl font-semibold text-[#0F4A0F]">Observabilité</h2><p className="text-sm text-gray-500">Présence et usage, actualisés toutes les 30 secondes.</p></div><div className="flex gap-2"><select value={days} onChange={e => setDays(Number(e.target.value) as 7 | 30 | 90)} className="rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-xs"><option value="7">7 jours</option><option value="30">30 jours</option><option value="90">90 jours</option></select><button onClick={() => { void overview.refetch(); void users.refetch() }} className="rounded-[10px] border border-gray-200 bg-white p-2" aria-label="Actualiser"><RefreshCw size={15} /></button></div></div>
    {overview.isError ? <div className="rounded-[16px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">Impossible de charger les données. Vérifiez vos droits puis réessayez.</div> : <>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{overview.isLoading ? [1,2,3,4].map(i => <SkeletonCard key={i} />) : cards.map(([label, value, Icon]) => <div key={label} className="rounded-[18px] border border-gray-100 bg-white p-5 shadow-sm"><Icon size={20} className="mb-3 text-[#1A6B1A]"/><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-2xl font-semibold text-[#0F4A0F]">{typeof value === 'number' ? fmt(value) : value}</p></div>)}</div>
      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2"><section className="rounded-[18px] border border-gray-100 bg-white p-5 shadow-sm"><h3 className="mb-3 font-semibold text-[#0F4A0F]">Sections les plus consultées</h3>{!d?.topPages.length ? <p className="text-sm text-gray-500">Aucune observation.</p> : <div className="space-y-2">{d.topPages.slice(0, 6).map(p => <div key={p.pageKey} className="flex justify-between text-sm"><span>{p.pageKey}</span><span className="text-gray-500">{duration(p.activeSeconds)} · {p.uniqueUsers} utilisateur(s)</span></div>)}</div>}</section><section className="rounded-[18px] border border-gray-100 bg-white p-5 shadow-sm"><h3 className="mb-3 font-semibold text-[#0F4A0F]">Activité quotidienne</h3>{!d?.daily.length ? <p className="text-sm text-gray-500">Aucune observation.</p> : <div className="space-y-2">{d.daily.slice(-7).map(x => <div key={x.day} className="flex justify-between text-sm"><span>{new Date(x.day).toLocaleDateString('fr-FR')}</span><span className="text-gray-500">{x.uniqueUsers} utilisateur(s) · {x.actions} action(s)</span></div>)}</div>}</section></div>
      <section className="rounded-[18px] border border-gray-100 bg-white p-5 shadow-sm"><h3 className="mb-4 font-semibold text-[#0F4A0F]">Utilisateurs et dernière présence</h3>{users.isLoading ? <p className="text-sm text-gray-400">Chargement…</p> : users.isError ? <p className="text-sm text-red-600">Liste indisponible.</p> : !users.data?.items.length ? <p className="text-sm text-gray-500">Aucun compte.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-gray-400"><th className="pb-2">Utilisateur</th><th className="pb-2">Rôle</th><th className="pb-2">Présence</th><th className="pb-2">Temps actif</th><th className="pb-2">Dernier signal</th></tr></thead><tbody>{users.data.items.map(u => <tr key={u.userId} className="border-b last:border-0"><td className="py-3 font-medium text-gray-700">{u.fullName}</td><td className="py-3 text-gray-500">{u.role}</td><td className="py-3">{u.presence}</td><td className="py-3">{duration(u.activeSeconds)}</td><td className="py-3 text-gray-500">{date(u.lastSeenAt)}</td></tr>)}</tbody></table></div>}</section>
    </>}
  </div>
}
