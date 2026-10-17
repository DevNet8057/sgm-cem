'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, Check, FileText, X } from 'lucide-react'
import api from '@/lib/api'
import { cn, formatAmount, formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useAppStore } from '@/store/appStore'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'

// Clôture mensuelle (lot 4.2, décision du Bureau) : le trésorier présente la
// position de fin de mois, un administrateur la vise ; le mois visé fige les
// montants de ses contributions.

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
type Statut = 'PRESENTEE' | 'VALIDEE' | 'REJETEE'
interface Closure {
  id: string; annee: number; mois: number; statut: Statut
  totalEncaisse: number; totalRembourse: number; nbContributions: number
  attenduCaisse: number; attenduBanque: number; attenduPortefeuille: number
  caisseComptee: number; soldeBancaire: number; soldePortefeuille: number
  justification: string | null; rejectionReason: string | null
  presentedById: string; presentedByName: string; presentedAt: string
  validatedByName: string | null; validatedAt: string | null
}
interface Preview {
  position: { beforeLedgerStart: boolean; ledgerStartedAt: string | null }
  libelle: string; totalEncaisse: number; totalRembourse: number; nbContributions: number
  attenduCaisse: number; attenduBanque: number; attenduPortefeuille: number
}
const STATUT: Record<Statut, { label: string; color: string }> = {
  PRESENTEE: { label: 'À viser', color: 'bg-amber-100 text-amber-800' },
  VALIDEE: { label: 'Mois clos', color: 'bg-green-100 text-green-800' },
  REJETEE: { label: 'Refusée', color: 'bg-red-100 text-red-700' },
}

function previousMonth() {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return { annee: d.getFullYear(), mois: d.getMonth() + 1 }
}

function apiError(err: unknown, fallback: string) {
  return (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? fallback
}

async function openPdf(id: string) {
  const tab = window.open('', '_blank')
  try {
    const res = await api.get(`/closures/${id}/pdf`, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data as Blob)
    if (tab) tab.location.href = url
    else window.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch {
    tab?.close()
  }
}

export function Clotures() {
  const queryClient = useQueryClient()
  const { addToast } = useAppStore()
  const role = useAuthStore(s => s.user?.role)
  const userId = useAuthStore(s => s.user?.id)
  const [period, setPeriod] = useState(previousMonth)
  const [counted, setCounted] = useState({ caisseComptee: '', soldeBancaire: '', soldePortefeuille: '', justification: '' })
  const [formError, setFormError] = useState('')
  const [rejectFor, setRejectFor] = useState<Closure | null>(null)
  const [reason, setReason] = useState('')
  const [rejectError, setRejectError] = useState('')

  const { data: closures = [], isLoading } = useQuery<Closure[]>({
    queryKey: ['closures'],
    queryFn: async () => (await api.get('/closures')).data.data,
  })
  const { data: preview } = useQuery<Preview>({
    queryKey: ['closure-preview', period.annee, period.mois],
    queryFn: async () => (await api.get('/closures/preview', { params: period })).data.data,
    enabled: role === 'TRESORIER',
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['closures'] })

  const present = useMutation({
    mutationFn: () => api.post('/closures', {
      ...period,
      caisseComptee: Number(counted.caisseComptee), soldeBancaire: Number(counted.soldeBancaire), soldePortefeuille: Number(counted.soldePortefeuille),
      ...(counted.justification.trim() ? { justification: counted.justification.trim() } : {}),
    }),
    onSuccess: () => { addToast({ title: 'Clôture présentée', message: 'Un administrateur doit la viser.', variant: 'success' }); setFormError(''); void refresh() },
    onError: err => setFormError(apiError(err, 'Présentation impossible')),
  })
  const validate = useMutation({
    mutationFn: (id: string) => api.patch(`/closures/${id}/validate`),
    onSuccess: () => { addToast({ title: 'Mois clos', message: 'Les montants du mois sont figés.', variant: 'success' }); void refresh() },
    onError: err => addToast({ title: 'Visa impossible', message: apiError(err, 'Réessayez.'), variant: 'error' }),
  })
  const reject = useMutation({
    mutationFn: () => api.patch(`/closures/${rejectFor!.id}/reject`, { reason: reason.trim() }),
    onSuccess: () => { setRejectFor(null); void refresh() },
    onError: err => setRejectError(apiError(err, 'Refus impossible')),
  })

  const gap = (value: string, expected?: number) => value === '' || expected === undefined ? null : Number(value) - expected
  const gaps = preview ? [gap(counted.caisseComptee, preview.attenduCaisse), gap(counted.soldeBancaire, preview.attenduBanque), gap(counted.soldePortefeuille, preview.attenduPortefeuille)] : []
  const hasGap = gaps.some(g => g !== null && g !== 0)
  const complete = counted.caisseComptee !== '' && counted.soldeBancaire !== '' && counted.soldePortefeuille !== ''
  const existing = closures.find(c => c.annee === period.annee && c.mois === period.mois)
  const canPresent = complete && (!hasGap || counted.justification.trim().length >= 10) && (!existing || existing.statut === 'REJETEE')

  const field = (key: 'caisseComptee' | 'soldeBancaire' | 'soldePortefeuille', label: string, expected: number | undefined, g: number | null) => (
    <label className="block text-xs font-semibold text-gray-600">
      {label}
      <span className="block font-normal text-slate-500">Attendu (grand livre) : {expected === undefined ? '…' : formatAmount(expected)}</span>
      <input type="number" inputMode="numeric" min={0} value={counted[key]} onChange={e => setCounted({ ...counted, [key]: e.target.value })}
        className="mt-1 block min-h-11 w-full rounded-[10px] border border-gray-200 px-3 text-base" />
      {g !== null && <span className={cn('mt-0.5 block font-semibold', g === 0 ? 'text-[#1A6B1A]' : 'text-red-700')}>{g === 0 ? 'Aucun écart' : `Écart : ${g > 0 ? '+' : ''}${formatAmount(g)}`}</span>}
    </label>
  )

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-5">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#1A6B1A]" />
        <div className="p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-[#1A6B1A]">Trésorerie</p>
          <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Clôtures mensuelles</h2>
          <p className="text-gray-500 text-sm mt-0.5">Le trésorier présente la position de fin de mois, un administrateur la vise. Un mois clos fige les montants de ses contributions ; une correction se fait par une écriture du mois en cours.</p>
        </div>
      </div>

      {role === 'TRESORIER' && (
        <section aria-labelledby="presenter" className="mb-5 rounded-[18px] border border-gray-100 bg-white p-4 space-y-3">
          <h3 id="presenter" className="font-display font-semibold text-[#0F4A0F]">Présenter une clôture</h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-semibold text-gray-600">
              Mois
              <select value={period.mois} onChange={e => setPeriod({ ...period, mois: Number(e.target.value) })}
                className="mt-1 block min-h-11 w-full rounded-[10px] border border-gray-200 px-3 text-base">
                {MOIS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-gray-600">
              Année
              <input type="number" value={period.annee} min={2020} max={2100} onChange={e => setPeriod({ ...period, annee: Number(e.target.value) })}
                className="mt-1 block min-h-11 w-full rounded-[10px] border border-gray-200 px-3 text-base" />
            </label>
          </div>
          {preview && (
            <p className="rounded-[10px] bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {preview.libelle} : {preview.nbContributions} contribution(s) confirmée(s), <b>{formatAmount(preview.totalEncaisse)}</b> encaissés
              {preview.totalRembourse > 0 && <>, {formatAmount(preview.totalRembourse)} remboursés</>}.
            </p>
          )}
          {preview?.position.beforeLedgerStart && (
            <p role="note" className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Ce mois se termine avant la mise en service du grand livre{preview.position.ledgerStartedAt ? ` (${formatDateTime(preview.position.ledgerStartedAt)})` : ''} : les montants attendus ne sont pas reconstituables et valent 0. Saisissez les montants comptés et expliquez-les dans la justification.
            </p>
          )}
          {existing && existing.statut !== 'REJETEE' && <p role="status" className="text-sm text-amber-800">Ce mois est déjà {existing.statut === 'VALIDEE' ? 'clos' : 'présenté'}.</p>}
          {field('caisseComptee', 'Caisse comptée (espèces et fonds remis au trésorier)', preview?.attenduCaisse, gaps[0] ?? null)}
          {field('soldeBancaire', 'Solde bancaire (relevé)', preview?.attenduBanque, gaps[1] ?? null)}
          {field('soldePortefeuille', 'Solde du portefeuille électronique', preview?.attenduPortefeuille, gaps[2] ?? null)}
          {hasGap && (
            <label className="block text-xs font-semibold text-gray-600">
              Justification des écarts <span className="text-red-500">*</span>
              <textarea value={counted.justification} onChange={e => setCounted({ ...counted, justification: e.target.value })} rows={3} maxLength={2000}
                className="mt-1 w-full rounded-[10px] border border-gray-200 px-3 py-2 text-base" />
            </label>
          )}
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
          <Button className="w-full" loading={present.isPending} disabled={!canPresent} onClick={() => present.mutate()}>
            <CalendarCheck size={14} /> Présenter la clôture
          </Button>
        </section>
      )}

      <section aria-label="Historique des clôtures" className="space-y-3">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-[16px] bg-gray-100" />)
        ) : closures.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="Aucune clôture" description="La première clôture est présentée par le trésorier après la fin du mois." />
        ) : closures.map(c => {
          const ecarts = (c.caisseComptee - c.attenduCaisse) || (c.soldeBancaire - c.attenduBanque) || (c.soldePortefeuille - c.attenduPortefeuille)
          return (
            <article key={c.id} className="rounded-[16px] border border-gray-100 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold capitalize text-gray-800">{MOIS[c.mois - 1]} {c.annee}</p>
                  <p className="text-xs text-slate-500">Présentée par {c.presentedByName} le {formatDateTime(c.presentedAt)}{c.validatedByName && ` · visée par ${c.validatedByName}`}</p>
                </div>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUT[c.statut].color)}>{STATUT[c.statut].label}</span>
              </div>
              <p className="mt-2 text-sm text-gray-700">Encaissé : <b>{formatAmount(c.totalEncaisse)}</b>{c.totalRembourse > 0 && ` · remboursé : ${formatAmount(c.totalRembourse)}`} · {ecarts === 0 ? 'aucun écart' : <span className="font-semibold text-red-700">écart(s) justifié(s)</span>}</p>
              {c.justification && <p className="mt-1 text-xs text-slate-600">Justification : {c.justification}</p>}
              {c.rejectionReason && <p className="mt-1 text-xs text-red-700">Refus : {c.rejectionReason}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {role === 'ADMIN' && c.statut === 'PRESENTEE' && c.presentedById !== userId && (
                  <>
                    <Button size="sm" loading={validate.isPending && validate.variables === c.id} onClick={() => validate.mutate(c.id)}><Check size={13} /> Viser et clore le mois</Button>
                    <Button size="sm" variant="outline" onClick={() => { setRejectError(''); setReason(''); setRejectFor(c) }}><X size={13} /> Refuser</Button>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={() => openPdf(c.id)}><FileText size={13} /> PDF de clôture</Button>
              </div>
            </article>
          )
        })}
      </section>

      <Modal open={!!rejectFor} onClose={() => setRejectFor(null)} size="sm" title="Refuser la clôture"
        description={rejectFor ? `${MOIS[rejectFor.mois - 1]} ${rejectFor.annee} : le trésorier pourra la présenter à nouveau.` : ''}>
        <label className="block text-xs font-semibold text-gray-600">
          Motif
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500}
            className="mt-1 w-full rounded-[10px] border border-gray-200 px-3 py-2 text-base" />
        </label>
        {rejectError && <p role="alert" className="mt-2 text-sm text-red-600">{rejectError}</p>}
        <div className="mt-4 flex justify-end gap-2 border-t border-gray-100 pt-3">
          <Button variant="ghost" onClick={() => setRejectFor(null)}>Annuler</Button>
          <Button variant="danger" loading={reject.isPending} disabled={reason.trim().length < 10} onClick={() => reject.mutate()}>Refuser</Button>
        </div>
      </Modal>
    </div>
  )
}
