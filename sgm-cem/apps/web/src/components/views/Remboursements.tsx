'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FileText, FolderOpen, Paperclip, Undo2, X } from 'lucide-react'
import api, { getBaseURL } from '@/lib/api'
import { cn, formatAmount, formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useAppStore } from '@/store/appStore'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'

// Remboursements à double validation (lot 4.1, décision du Bureau) :
// demande du trésorier → visa d'un administrateur ou d'un responsable →
// argent rendu hors application → exécution enregistrée avec preuve.

type Statut = 'DEMANDE' | 'VALIDE' | 'EXECUTE' | 'REJETE' | 'ANNULE'
interface Refund {
  id: string
  montant: number
  moyen: 'ESPECES' | 'MOBILE_MONEY' | 'VIREMENT'
  motif: string
  beneficiaire: string | null
  statut: Statut
  requestedById: string
  requestedByName: string
  requestedAt: string
  validatedByName: string | null
  validatedAt: string | null
  rejectionReason: string | null
  executedByName: string | null
  executedAt: string | null
  sourceLocation: string | null
  reference: string | null
  hasProof: boolean
  contribution: {
    id: string
    montant: number
    createdAt: string
    membre: { user: { fullName: string } } | null
    contributeurExterne: { nom: string } | null
    rubrique: { code: string; title: string }
  }
}

const STATUT_LABELS: Record<Statut, string> = {
  DEMANDE: 'À viser', VALIDE: 'Visé, à exécuter', EXECUTE: 'Remboursé', REJETE: 'Refusé', ANNULE: 'Annulé',
}
const STATUT_COLORS: Record<Statut, string> = {
  DEMANDE: 'bg-amber-100 text-amber-800', VALIDE: 'bg-blue-100 text-blue-800', EXECUTE: 'bg-green-100 text-green-800',
  REJETE: 'bg-red-100 text-red-700', ANNULE: 'bg-gray-100 text-gray-600',
}
const MOYEN_LABELS = { ESPECES: 'Espèces', MOBILE_MONEY: 'Mobile Money', VIREMENT: 'Virement' } as const
const SOURCES = [
  { value: 'EN_CAISSE', label: 'Caisse' },
  { value: 'REMIS_TRESORIER', label: 'Fonds chez le trésorier' },
  { value: 'PORTEFEUILLE_ELECTRONIQUE', label: 'Portefeuille électronique' },
  { value: 'EN_BANQUE', label: 'Compte bancaire' },
]
const FILTERS: Array<{ value: Statut | ''; label: string }> = [
  { value: 'DEMANDE', label: 'À viser' }, { value: 'VALIDE', label: 'À exécuter' }, { value: 'EXECUTE', label: 'Remboursés' }, { value: '', label: 'Tous' },
]

function apiError(err: unknown, fallback: string) {
  return (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? fallback
}

async function openRefundProof(id: string) {
  const tab = window.open('', '_blank')
  try {
    const res = await api.get(`/refunds/${id}/proof`, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data as Blob)
    if (tab) tab.location.href = url
    else window.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch {
    tab?.close()
  }
}

export function Remboursements() {
  const queryClient = useQueryClient()
  const { addToast } = useAppStore()
  const role = useAuthStore(s => s.user?.role)
  const userId = useAuthStore(s => s.user?.id)
  const isTreasurer = role === 'TRESORIER'
  const isValidator = role === 'ADMIN' || role === 'RESPONSABLE'
  const [filter, setFilter] = useState<Statut | ''>(isValidator ? 'DEMANDE' : 'VALIDE')
  const [rejectFor, setRejectFor] = useState<Refund | null>(null)
  const [reason, setReason] = useState('')
  const [executeFor, setExecuteFor] = useState<Refund | null>(null)
  const [exec, setExec] = useState({ sourceLocation: 'EN_CAISSE', reference: '' })
  const [proof, setProof] = useState<File | null>(null)
  const [modalError, setModalError] = useState('')

  const { data = [], isLoading } = useQuery<Refund[]>({
    queryKey: ['refunds', filter],
    queryFn: async () => (await api.get('/refunds', { params: { statut: filter || undefined } })).data.data,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['refunds'] })

  const validate = useMutation({
    mutationFn: (id: string) => api.patch(`/refunds/${id}/validate`),
    onSuccess: () => { addToast({ title: 'Remboursement visé', variant: 'success' }); void refresh() },
    onError: err => addToast({ title: 'Visa impossible', message: apiError(err, 'Réessayez.'), variant: 'error' }),
  })
  const cancel = useMutation({
    mutationFn: (id: string) => api.patch(`/refunds/${id}/cancel`),
    onSuccess: () => { void refresh() },
    onError: err => addToast({ title: 'Annulation impossible', message: apiError(err, 'Réessayez.'), variant: 'error' }),
  })
  const reject = useMutation({
    mutationFn: () => api.patch(`/refunds/${rejectFor!.id}/reject`, { reason: reason.trim() }),
    onSuccess: () => { setRejectFor(null); void refresh() },
    onError: err => setModalError(apiError(err, 'Refus impossible')),
  })
  const execute = useMutation({
    mutationFn: () => {
      const form = new FormData()
      form.append('sourceLocation', exec.sourceLocation)
      if (exec.reference.trim()) form.append('reference', exec.reference.trim())
      form.append('proof', proof!)
      return api.patch(`/refunds/${executeFor!.id}/execute`, form)
    },
    onSuccess: () => { setExecuteFor(null); addToast({ title: 'Remboursement enregistré', message: 'La preuve est archivée.', variant: 'success' }); void refresh() },
    onError: err => setModalError(apiError(err, 'Enregistrement impossible')),
  })

  return (
    <div className="p-4 md:p-6 animate-page-enter">
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-5">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#1A6B1A]" />
        <div className="p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-[#1A6B1A]">Trésorerie</p>
          <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Remboursements</h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Demandés par le trésorier depuis une contribution confirmée, visés par un administrateur ou un responsable, puis enregistrés avec la preuve une fois l&apos;argent rendu.
          </p>
        </div>
      </div>

      <div role="tablist" aria-label="Filtrer par état" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button key={f.label} role="tab" aria-selected={filter === f.value} onClick={() => setFilter(f.value)}
            className={cn('min-h-10 rounded-full border px-4 text-sm font-semibold transition-colors',
              filter === f.value ? 'border-[#1A6B1A] bg-[#1A6B1A] text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50')}>
            {f.label}
          </button>
        ))}
      </div>

      <section aria-label="Liste des remboursements" className="space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-[16px] bg-gray-100" />)
        ) : data.length === 0 ? (
          <EmptyState icon={Undo2} title="Aucun remboursement" description="Un remboursement se demande depuis la fiche d'une contribution confirmée (trésorier)." />
        ) : data.map(r => {
          const name = r.contribution.membre?.user.fullName ?? r.contribution.contributeurExterne?.nom ?? 'Contributeur'
          return (
            <article key={r.id} className="rounded-[16px] border border-gray-100 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-gray-800">{name}</p>
                  <p className="truncate text-xs text-slate-500">{r.contribution.rubrique.code} · contribution de {formatAmount(r.contribution.montant)} du {formatDateTime(r.contribution.createdAt)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-lg font-bold text-[#0F4A0F]">{formatAmount(r.montant)}</p>
                  <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUT_COLORS[r.statut])}>{STATUT_LABELS[r.statut]}</span>
                </div>
              </div>
              <p className="mt-2 text-sm text-gray-700">{r.motif}</p>
              <p className="mt-1 text-xs text-slate-500">
                {MOYEN_LABELS[r.moyen]}{r.beneficiaire ? ` · à ${r.beneficiaire}` : ''} · demandé par {r.requestedByName} le {formatDateTime(r.requestedAt)}
                {r.validatedByName && ` · visé par ${r.validatedByName}`}
                {r.executedByName && r.executedAt && ` · rendu le ${formatDateTime(r.executedAt)}${r.reference ? ` (réf. ${r.reference})` : ''}`}
              </p>
              {r.rejectionReason && <p className="mt-1 text-xs text-red-700">Refus : {r.rejectionReason}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {isValidator && r.statut === 'DEMANDE' && r.requestedById !== userId && (
                  <Button size="sm" loading={validate.isPending && validate.variables === r.id} onClick={() => validate.mutate(r.id)}><Check size={13} /> Viser</Button>
                )}
                {isValidator && (r.statut === 'DEMANDE' || r.statut === 'VALIDE') && (
                  <Button size="sm" variant="outline" onClick={() => { setModalError(''); setReason(''); setRejectFor(r) }}><X size={13} /> Refuser</Button>
                )}
                {isTreasurer && r.statut === 'VALIDE' && (
                  <Button size="sm" onClick={() => { setModalError(''); setProof(null); setExec({ sourceLocation: r.moyen === 'MOBILE_MONEY' ? 'PORTEFEUILLE_ELECTRONIQUE' : r.moyen === 'VIREMENT' ? 'EN_BANQUE' : 'EN_CAISSE', reference: '' }); setExecuteFor(r) }}>
                    <Undo2 size={13} /> Argent rendu
                  </Button>
                )}
                {isTreasurer && (r.statut === 'DEMANDE' || r.statut === 'VALIDE') && (
                  <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables === r.id} onClick={() => cancel.mutate(r.id)}>Annuler la demande</Button>
                )}
                {r.hasProof && <Button size="sm" variant="ghost" onClick={() => openRefundProof(r.id)}><Paperclip size={13} /> Voir la preuve</Button>}
                <Button size="sm" variant="ghost" onClick={() => window.open(`${getBaseURL()}/documents/remboursements/${r.id}/avis`, '_blank')}><FileText size={13} /> Avis PDF</Button>
              </div>
            </article>
          )
        })}
      </section>

      <Modal open={!!rejectFor} onClose={() => setRejectFor(null)} size="sm" title="Refuser le remboursement"
        description={rejectFor ? `${formatAmount(rejectFor.montant)} demandé par ${rejectFor.requestedByName}.` : ''}>
        <label className="block text-xs font-semibold text-gray-600">
          Motif du refus
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500}
            className="mt-1 w-full rounded-[10px] border border-gray-200 px-3 py-2 text-base" />
        </label>
        {modalError && <p role="alert" className="mt-2 text-sm text-red-600">{modalError}</p>}
        <div className="mt-4 flex justify-end gap-2 border-t border-gray-100 pt-3">
          <Button variant="ghost" onClick={() => setRejectFor(null)}>Annuler</Button>
          <Button variant="danger" loading={reject.isPending} disabled={reason.trim().length < 10} onClick={() => reject.mutate()}>Refuser</Button>
        </div>
      </Modal>

      <Modal open={!!executeFor} onClose={() => setExecuteFor(null)} size="sm" title="Enregistrer le remboursement"
        description={executeFor ? `Vous avez rendu ${formatAmount(executeFor.montant)} (${MOYEN_LABELS[executeFor.moyen]}). La preuve est obligatoire et sera archivée.` : ''}>
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-gray-600">
            L&apos;argent est sorti de
            <select value={exec.sourceLocation} onChange={e => setExec({ ...exec, sourceLocation: e.target.value })}
              className="mt-1 block min-h-11 w-full rounded-[10px] border border-gray-200 px-3 text-base">
              {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-gray-600">
            Référence (transaction, virement, reçu) — facultatif
            <input value={exec.reference} onChange={e => setExec({ ...exec, reference: e.target.value })} maxLength={120}
              className="mt-1 block min-h-11 w-full rounded-[10px] border border-gray-200 px-3 text-base" />
          </label>
          <label className={cn('flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-dashed px-3 text-sm',
            proof ? 'border-[#1A6B1A] bg-[#E8F5E8] text-[#0F4A0F]' : 'border-gray-300 text-slate-600')}>
            <FolderOpen size={15} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{proof ? proof.name : 'Preuve (reçu signé, capture, avis) — obligatoire'}</span>
            <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment"
              aria-label="Preuve du remboursement" onChange={e => setProof(e.target.files?.[0] ?? null)} />
          </label>
          {modalError && <p role="alert" className="text-sm text-red-600">{modalError}</p>}
          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <Button variant="ghost" onClick={() => setExecuteFor(null)}>Annuler</Button>
            <Button loading={execute.isPending} disabled={!proof} onClick={() => execute.mutate()}><Undo2 size={14} /> Enregistrer</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
