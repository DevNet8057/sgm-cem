'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, CheckCircle2, Database, HardDrive, Send, Server, ShieldAlert } from 'lucide-react'
import api from '@/lib/api'
import { formatDateTime } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'

// Santé du système (EF-M10-01, accueil administrateur) et incidents techniques (point 17)
interface Sante {
  statut: 'ok' | 'attention' | 'critique'
  version: string
  database: 'ok' | 'erreur'
  redis: 'ok' | 'absent' | 'erreur'
  stockage: 'S3' | 'local'
  taches: Array<{ nom: string; libelle: string; sante: 'ok' | 'retard' | 'erreur' | 'jamais'; dernierSucces: string | null; derniereErreur: string | null; erreur: string | null }>
  envois: { enAttente: number; echecs24h: number }
  paiementsBloques: number
  incidents: { ouverts: number; derniers: Array<{ id: string; source: 'TACHE' | 'WEBHOOK' | 'ENVOI'; code: string; message: string; occurrences: number; derniereFois: string }> }
}

const STATUT = {
  ok: { label: 'Tout fonctionne', className: 'bg-[#E8F5E8] text-[#1A6B1A]' },
  attention: { label: 'À surveiller', className: 'bg-amber-50 text-amber-700' },
  critique: { label: 'Intervention requise', className: 'bg-red-50 text-red-700' },
}
const SOURCE = { TACHE: 'Tâche', WEBHOOK: 'Webhook', ENVOI: 'Envoi' }

export function SanteCard() {
  const queryClient = useQueryClient()
  const addToast = useAppStore(s => s.addToast)
  const { data, isLoading, isError } = useQuery<Sante>({
    queryKey: ['sante'],
    queryFn: async () => (await api.get('/sante')).data.data,
    refetchInterval: 60_000,
  })
  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/sante/incidents/${id}/resoudre`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['sante'] }); addToast({ title: 'Incident marqué résolu', variant: 'success' }) },
    onError: () => addToast({ title: 'Action impossible', variant: 'error' }),
  })

  if (isLoading) return null
  if (isError || !data) {
    return <section className="rounded-[18px] border border-red-100 bg-red-50 p-4 text-sm text-red-700">Santé du système indisponible : l&apos;API ne répond pas correctement.</section>
  }
  const problemes = data.taches.filter(t => t.sante === 'erreur' || t.sante === 'retard')
  const tachesOk = data.taches.filter(t => t.sante === 'ok').length

  return (
    <section aria-label="Santé du système" className="rounded-[18px] border border-gray-100 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[#0F4A0F]"><Activity size={16} /> Santé du système</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUT[data.statut].className}`}>{STATUT[data.statut].label}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Indicateur icon={Database} label="Base de données" valeur={data.database === 'ok' ? 'Disponible' : 'Injoignable'} ok={data.database === 'ok'} />
        <Indicateur icon={Server} label="Redis" valeur={data.redis === 'ok' ? 'Disponible' : data.redis === 'absent' ? 'Non configuré' : 'Injoignable'} ok={data.redis !== 'erreur'} />
        <Indicateur icon={Send} label="Envois" valeur={`${data.envois.enAttente} en attente · ${data.envois.echecs24h} échec(s) 24 h`} ok={data.envois.echecs24h === 0} />
        <Indicateur icon={HardDrive} label="Fichiers" valeur={data.stockage === 'S3' ? 'Stockage objet' : 'Disque du serveur'} ok />
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Tâches planifiées : {tachesOk} sur {data.taches.length} à jour
        {data.taches.some(t => t.sante === 'jamais') && ' (les autres n’ont pas encore tourné depuis la mise en service)'}
        {data.paiementsBloques > 0 && ` · ${data.paiementsBloques} paiement(s) électronique(s) bloqué(s)`} · version {data.version}
      </p>
      {problemes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {problemes.map(t => (
            <li key={t.nom} className="rounded-[10px] bg-red-50 px-3 py-2 text-xs text-red-700">
              <strong>{t.libelle}</strong> — {t.sante === 'erreur' ? `en échec le ${formatDateTime(t.derniereErreur!)} : ${t.erreur ?? ''}` : `en retard (dernier succès : ${t.dernierSucces ? formatDateTime(t.dernierSucces) : 'jamais'})`}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mb-1 mt-4 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500"><ShieldAlert size={13} /> Incidents ouverts ({data.incidents.ouverts})</h3>
      {data.incidents.derniers.length === 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-gray-500"><CheckCircle2 size={14} className="text-[#1A6B1A]" /> Aucun incident en cours.</p>
      ) : (
        <ul className="divide-y divide-gray-50">
          {data.incidents.derniers.map(i => (
            <li key={i.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-gray-800">{SOURCE[i.source]} « {i.code} »{i.occurrences > 1 && <span className="ml-1 text-xs font-normal text-gray-400">×{i.occurrences}</span>}</p>
                <p className="break-words text-xs text-gray-500">{i.message} · {formatDateTime(i.derniereFois)}</p>
              </div>
              <button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate(i.id)}
                className="shrink-0 self-start rounded-[8px] border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 sm:self-auto">
                Marquer résolu
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Indicateur({ icon: Icon, label, valeur, ok }: { icon: React.ElementType; label: string; valeur: string; ok: boolean }) {
  return (
    <div className="rounded-[12px] border border-gray-100 p-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400"><Icon size={12} /> {label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${ok ? 'text-gray-800' : 'text-red-600'}`}>{valeur}</p>
    </div>
  )
}
