'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Archive, Bell, CalendarPlus, Edit3, FolderOpen, Lock, Plus, Search, Unlock, X } from 'lucide-react'
import api from '@/lib/api'
import { cn, formatAmount, progressGradient, ROLE_LEVELS } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SkeletonCard } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import type { Rubrique, RubriqueStatut } from '@/types'

const emptyForm = {
  code: '',
  title: '',
  description: '',
  type: 'REGULIERE_MENSUELLE',
  priority: 'NORMAL',
  fiscalYear: new Date().getFullYear(),
  openDate: new Date().toISOString().slice(0, 10),
  closeDate: '',
  amountTravailleur: '',
  amountEtudiant: '',
  amountCouple: '',
  targetAmount: '',
  targetAll: true,
}

type RubriqueForm = typeof emptyForm

export function Rubriques() {
  // Gestion des rubriques (création, modification, reconduction, statut) : niveau 3 et plus
  const canManage = (ROLE_LEVELS[useAuthStore(s => s.user?.role) ?? ''] ?? 0) >= 3
  const queryClient = useQueryClient()
  const [search,       setSearch]       = useState('')
  const [filterType,   setFilterType]   = useState('')
  const [filterStatut, setFilterStatut] = useState('')
  const [mode,         setMode]         = useState<'none' | 'create' | 'edit'>('none')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<RubriqueForm>(emptyForm)
  const [error, setError] = useState('')

  const { data, isLoading } = useQuery<Rubrique[]>({
    queryKey: ['rubriques'],
    queryFn: async () => (await api.get('/rubriques')).data.data,
  })

  // Ratios lisibles par les responsables (niveau 3) : /settings complet est réservé à la trésorerie
  const { data: settings } = useQuery<{ etudiantRatio: number; coupleRatio: number; defaultIncreaseRate: number }>({
    queryKey: ['settings-ratios'],
    queryFn: async () => (await api.get('/settings/ratios')).data.data,
    staleTime: 5 * 60 * 1000,
    enabled: canManage,
  })

  // Reconduction N → N+1 (EF-M04-03)
  const [renewFor, setRenewFor] = useState<Rubrique | null>(null)
  const [renewRate, setRenewRate] = useState('')
  const [renewError, setRenewError] = useState('')
  const renew = useMutation({
    mutationFn: () => api.post(`/rubriques/${renewFor!.id}/reconduire`, { increaseRate: Number(renewRate) }),
    onSuccess: async () => { setRenewFor(null); await resetAndRefresh() },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setRenewError(e.response?.data?.error?.message ?? 'Reconduction impossible')
    },
  })
  const revalue = (v?: number | null) => v == null ? null : Math.max(100, Math.round(v * (1 + (Number(renewRate) || 0) / 100) / 100) * 100)

  const etudiantRatio: number = settings?.etudiantRatio ?? 0.5
  const coupleRatio: number = settings?.coupleRatio ?? 1.5

  const createRubrique = useMutation({
    mutationFn: async () => api.post('/rubriques', serializeForm(form)),
    onSuccess: resetAndRefresh,
    onError: showApiError,
  })

  const updateRubrique = useMutation({
    mutationFn: async () => api.patch(`/rubriques/${editingId}`, serializeForm(form)),
    onSuccess: resetAndRefresh,
    onError: showApiError,
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: RubriqueStatut }) => api.patch(`/rubriques/${id}/status`, { status }),
    onSuccess: resetAndRefresh,
    onError: showApiError,
  })

  async function resetAndRefresh() {
    setMode('none')
    setEditingId(null)
    setForm(emptyForm)
    setError('')
    await queryClient.invalidateQueries({ queryKey: ['rubriques'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    await queryClient.invalidateQueries({ queryKey: ['monthly-stats'] })
  }

  function showApiError(err: unknown) {
    const e = err as { response?: { data?: { error?: { message?: string } } } }
    setError(e.response?.data?.error?.message ?? 'Operation impossible')
  }

  function startCreate() {
    setMode(mode === 'create' ? 'none' : 'create')
    setEditingId(null)
    setForm(emptyForm)
    setError('')
  }

  function startEdit(r: Rubrique) {
    setMode('edit')
    setEditingId(r.id)
    setError('')
    setForm({
      code: r.code,
      title: r.title,
      description: r.description ?? '',
      type: r.type,
      priority: r.priority,
      fiscalYear: r.fiscalYear,
      openDate: toDateInput(r.openDate),
      closeDate: r.closeDate ? toDateInput(r.closeDate) : '',
      amountTravailleur: toStringValue(r.amountTravailleur),
      amountEtudiant: toStringValue(r.amountEtudiant),
      amountCouple: toStringValue(r.amountCouple),
      targetAmount: toStringValue(r.targetAmount),
      targetAll: r.targetAll,
    })
  }

  const rubriques = (data ?? []).filter(r => {
    const q = search.toLowerCase()
    const matchSearch = !q || r.title.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)
    const matchType   = !filterType   || r.type === filterType
    const matchStatut = !filterStatut || r.status === filterStatut
    return matchSearch && matchType && matchStatut
  })

  return (
    <div className="p-4 md:p-6 animate-page-enter">
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#F59E0B]" />
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-amber-800">Catégorisation</p>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Rubriques</h2>
            <p className="text-gray-500 text-sm mt-0.5">{data?.length ?? 0} rubrique(s) configurée(s)</p>
          </div>
          {canManage && (
            <Button size="sm" onClick={startCreate}>
              {mode === 'create' ? <X size={14} /> : <Plus size={14} />}
              {mode === 'create' ? 'Fermer' : 'Nouvelle rubrique'}
            </Button>
          )}
        </div>
      </div>

      {(mode === 'create' || mode === 'edit') && (
        <RubriqueEditor
          mode={mode}
          form={form}
          setForm={setForm}
          error={error}
          loading={createRubrique.isPending || updateRubrique.isPending}
          onCancel={() => { setMode('none'); setEditingId(null); setError('') }}
          onSubmit={() => mode === 'create' ? createRubrique.mutate() : updateRubrique.mutate()}
          etudiantRatio={etudiantRatio}
          coupleRatio={coupleRatio}
        />
      )}

      {/* D2 : Recherche + filter chips */}
      <div className="mb-5 space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher une rubrique..."
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A]"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: 'Mensuelle',   value: 'REGULIERE_MENSUELLE', active: 'bg-[#1A6B1A] text-white border-[#1A6B1A]' },
            { label: 'Ponctuelle',  value: 'PONCTUELLE',          active: 'bg-blue-600 text-white border-blue-600' },
            { label: 'Urgente',     value: 'URGENTE',             active: 'bg-red-600 text-white border-red-600' },
          ].map(({ label, value, active }) => (
            <button key={value} type="button" onClick={() => setFilterType(filterType === value ? '' : value)}
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-semibold border transition-all',
                filterType === value ? active : 'bg-white text-gray-600 border-gray-200 hover:border-[#1A6B1A]/40'
              )}>
              {label}
            </button>
          ))}
          {[
            { label: 'Ouverte',  value: 'OUVERTE',  active: 'bg-emerald-600 text-white border-emerald-600' },
            { label: 'Fermée',   value: 'FERMEE',   active: 'bg-amber-500 text-white border-amber-500' },
            { label: 'Archivée', value: 'ARCHIVEE', active: 'bg-gray-500 text-white border-gray-500' },
          ].map(({ label, value, active }) => (
            <button key={value} type="button" onClick={() => setFilterStatut(filterStatut === value ? '' : value)}
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-semibold border transition-all',
                filterStatut === value ? active : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-300'
              )}>
              {label}
            </button>
          ))}
          {(filterType || filterStatut) && (
            <button type="button" onClick={() => { setFilterType(''); setFilterStatut('') }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border border-red-200 text-red-500 bg-red-50 hover:bg-red-100 transition-all">
              <X size={10} />Effacer
            </button>
          )}
          <span className="ml-auto self-center text-xs text-gray-400">{rubriques.length} résultat(s)</span>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : rubriques.length === 0 ? (
        <EmptyState icon={FolderOpen} title="Aucune rubrique" description={canManage ? 'Commencez par créer une rubrique de contribution' : 'Aucune rubrique n’est encore ouverte'} {...(canManage && { actionLabel: 'Créer une rubrique', onAction: startCreate })} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-children">
          {rubriques.map(r => (
            <RubriqueCard
              key={r.id}
              rubrique={r}
              loadingStatus={updateStatus.isPending}
              canManage={canManage}
              onEdit={() => startEdit(r)}
              onStatus={(status) => updateStatus.mutate({ id: r.id, status })}
              onRenew={() => { setRenewError(''); setRenewRate(String(settings?.defaultIncreaseRate ?? 0)); setRenewFor(r) }}
            />
          ))}
        </div>
      )}

      <Modal open={!!renewFor} onClose={() => setRenewFor(null)} size="sm"
        title={renewFor ? `Reconduire en ${renewFor.fiscalYear + 1}` : ''}
        description="Une nouvelle rubrique est créée pour l'année suivante, avec les mêmes caractéristiques ; celle-ci reste inchangée.">
        {renewFor && (
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-gray-600">
              Revalorisation des montants (%)
              <input type="number" min={0} max={100} step="0.5" value={renewRate} onChange={e => setRenewRate(e.target.value)}
                className="mt-1 block min-h-11 w-full rounded-[10px] border border-gray-200 px-3 text-base" />
            </label>
            <ul className="space-y-1 rounded-[10px] bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {([['Travailleur', renewFor.amountTravailleur], ['Étudiant', renewFor.amountEtudiant], ['Couple', renewFor.amountCouple], ['Objectif', renewFor.targetAmount]] as const)
                .filter(([, v]) => v != null)
                .map(([label, v]) => <li key={label} className="flex justify-between"><span>{label}</span><span className="font-mono">{formatAmount(v)} → <b>{formatAmount(revalue(v))}</b></span></li>)}
              {renewFor.amountTravailleur == null && renewFor.amountEtudiant == null && renewFor.amountCouple == null && <li>Contribution libre</li>}
            </ul>
            <p className="text-xs text-slate-500">Montants arrondis à la centaine ; dates décalées d&apos;un an.</p>
            {renewError && <p role="alert" className="text-sm text-red-600">{renewError}</p>}
            <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
              <Button variant="ghost" onClick={() => setRenewFor(null)}>Annuler</Button>
              <Button loading={renew.isPending} disabled={renewRate === '' || Number(renewRate) < 0 || Number(renewRate) > 100} onClick={() => renew.mutate()}>
                <CalendarPlus size={14} /> Reconduire
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function RubriqueEditor({ mode, form, setForm, error, loading, onCancel, onSubmit, etudiantRatio, coupleRatio }: {
  mode: 'create' | 'edit'
  form: RubriqueForm
  setForm: (form: RubriqueForm) => void
  error: string
  loading: boolean
  onCancel: () => void
  onSubmit: () => void
  etudiantRatio: number
  coupleRatio: number
}) {
  function handleTravailleurChange(v: string) {
    const base = Number(v)
    const etudiant = base > 0 ? String(Math.round(base * etudiantRatio)) : ''
    const couple = base > 0 ? String(Math.round(base * coupleRatio)) : ''
    setForm({ ...form, amountTravailleur: v, amountEtudiant: etudiant, amountCouple: couple })
  }
  return (
    <form
      onSubmit={e => { e.preventDefault(); onSubmit() }}
      className="mb-5 bg-white rounded-[18px] border border-gray-100 p-4 grid grid-cols-1 md:grid-cols-4 gap-3"
    >
      <div className="md:col-span-4 flex items-center justify-between">
        <h3 className="font-display font-semibold text-[#0F4A0F]">{mode === 'create' ? 'Créer une rubrique' : 'Modifier la rubrique'}</h3>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
      </div>
      {/* Toggle urgent */}
      <div className="md:col-span-4">
        <label className={`flex items-center gap-3 p-3 rounded-[12px] border-2 cursor-pointer transition-all ${form.priority === 'URGENT' ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}>
          <input type="checkbox" className="sr-only"
            checked={form.priority === 'URGENT'}
            onChange={e => setForm({ ...form, priority: e.target.checked ? 'URGENT' : 'NORMAL', type: e.target.checked ? 'URGENTE' : form.type })}
          />
          <div className={`w-10 h-6 rounded-full relative transition-colors ${form.priority === 'URGENT' ? 'bg-red-500' : 'bg-gray-300'}`}>
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.priority === 'URGENT' ? 'translate-x-5' : 'translate-x-1'}`} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
              <AlertTriangle size={14} className={form.priority === 'URGENT' ? 'text-red-500' : 'text-gray-400'} />
              Rubrique urgente
            </p>
            <p className="text-xs text-gray-500">Active l&apos;alerte prioritaire et notifie tous les membres</p>
          </div>
        </label>
        {form.priority === 'URGENT' && (
          <div className="mt-2 flex items-start gap-2 rounded-[10px] bg-red-100 border border-red-300 px-3 py-2.5 text-xs text-red-800">
            <Bell size={13} className="mt-0.5 shrink-0" />
            <span>
              <strong>Notification de masse :</strong> tous les membres actifs seront notifiés par WhatsApp/SMS dès la validation de cette rubrique.
            </span>
          </div>
        )}
      </div>

      <Input label="Code" value={form.code} onChange={code => setForm({ ...form, code })} required />
      <Input label="Titre" value={form.title} onChange={title => setForm({ ...form, title })} required />
      <Select label="Type" value={form.type} onChange={type => setForm({ ...form, type })} options={['REGULIERE_MENSUELLE', 'PONCTUELLE', 'URGENTE']} />
      <Select label="Priorité" value={form.priority} onChange={priority => setForm({ ...form, priority })} options={['NORMAL', 'PRIORITAIRE', 'URGENT']} />
      <Input label="Annee" type="number" value={String(form.fiscalYear)} onChange={fiscalYear => setForm({ ...form, fiscalYear: Number(fiscalYear) })} required />
      <Input label="Date ouverture" type="date" value={form.openDate} onChange={openDate => setForm({ ...form, openDate })} required />
      <Input label="Date fermeture" type="date" value={form.closeDate} onChange={closeDate => setForm({ ...form, closeDate })} />
      <Input label="Objectif" type="number" value={form.targetAmount} onChange={targetAmount => setForm({ ...form, targetAmount })} />
      <Input label="Montant travailleur (FCFA)" type="number" value={form.amountTravailleur} onChange={handleTravailleurChange} />
      <div>
        <Input label={`Montant étudiant (×${etudiantRatio} auto)`} type="number" value={form.amountEtudiant} onChange={amountEtudiant => setForm({ ...form, amountEtudiant })} />
        {form.amountTravailleur && <p className="text-xs text-blue-500 mt-0.5">Calculé auto depuis montant × {etudiantRatio}</p>}
      </div>
      <div>
        <Input label={`Montant couple (×${coupleRatio} auto)`} type="number" value={form.amountCouple} onChange={amountCouple => setForm({ ...form, amountCouple })} />
        {form.amountTravailleur && <p className="text-xs text-purple-500 mt-0.5">Calculé auto depuis montant × {coupleRatio}</p>}
      </div>
      <label className="block">
        <span className="text-xs font-semibold text-gray-600">Cible</span>
        <select value={form.targetAll ? 'all' : 'custom'} onChange={e => setForm({ ...form, targetAll: e.target.value === 'all' })}
          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30">
          <option value="all">Tous les membres</option>
          <option value="custom">Cible specifique</option>
        </select>
      </label>
      <label className="md:col-span-4 block">
        <span className="text-xs font-semibold text-gray-600">Description</span>
        <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30" />
      </label>
      {error && <p className="md:col-span-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-[10px] px-3 py-2">{error}</p>}
      <div className="md:col-span-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Annuler</Button>
        <Button loading={loading}>{mode === 'create' ? 'Créer la rubrique' : 'Enregistrer les changements'}</Button>
      </div>
    </form>
  )
}

function RubriqueCard({ rubrique: r, loadingStatus, canManage, onEdit, onStatus, onRenew }: {
  rubrique: Rubrique
  loadingStatus: boolean
  canManage: boolean
  onEdit: () => void
  onStatus: (status: RubriqueStatut) => void
  onRenew: () => void
}) {
  const ratio = r.targetAmount ? (r.totalCollecte ?? 0) / r.targetAmount : 0
  const topColor = r.priority === 'URGENT' ? 'from-red-500 to-red-400' :
    r.priority === 'PRIORITAIRE' ? 'from-orange-500 to-amber-400' : 'from-[#1A6B1A] to-[#2D8C2D]'

  return (
    <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden hover:shadow-cem-lg hover:-translate-y-1 hover:border-[#1A6B1A]/30 transition-all duration-200 group">
      <div className={`h-1.5 bg-linear-to-r ${topColor}`} />
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[11px] text-gray-600 bg-gray-100 px-2 py-0.5 rounded">{r.code}</span>
              <StatusBadge status={r.priority === 'URGENT' ? 'URGENT' : r.status} dot={false} />
            </div>
            <h3 className="font-display font-semibold text-gray-800 text-sm leading-tight">{r.title}</h3>
            {r.description && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{r.description}</p>}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          <AmountPill label="Trav." value={r.amountTravailleur} />
          <AmountPill label="Etud." value={r.amountEtudiant} />
          <AmountPill label="Couple" value={r.amountCouple} />
          {r.amountTravailleur == null && r.amountEtudiant == null && r.amountCouple == null && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-gray-100 text-gray-600">Contribution libre</span>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
          <span>{r.nbContributions ?? 0} contribution(s){r.totalScope === 'COLLECTEUR' ? ' encaissée(s) par vous' : r.totalScope === 'MEMBRE' ? ' de votre part' : ''}</span>
          <span className="font-mono font-semibold text-[#1A6B1A]">{formatAmount(r.totalCollecte)}</span>
        </div>

        {r.targetAmount && (r.totalScope ?? 'GLOBAL') === 'GLOBAL' && (
          <div className="mb-4">
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.min(100, ratio * 100)}%`, background: progressGradient(ratio) }} />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">{Math.round(ratio * 100)}% de {formatAmount(r.targetAmount)}</p>
          </div>
        )}

        {canManage && <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
          <Button size="sm" variant="outline" onClick={onEdit}><Edit3 size={13} />Modifier</Button>
          <Button size="sm" variant="ghost" onClick={onRenew}><CalendarPlus size={13} />Reconduire</Button>
          {r.status !== 'OUVERTE' ? (
            <Button size="sm" variant="ghost" loading={loadingStatus} onClick={() => onStatus('OUVERTE')}><Unlock size={13} />Ouvrir</Button>
          ) : (
            <Button size="sm" variant="ghost" loading={loadingStatus} onClick={() => onStatus('FERMEE')}><Lock size={13} />Fermer</Button>
          )}
          {r.status !== 'ARCHIVEE' && (
            <Button size="sm" variant="danger" loading={loadingStatus} onClick={() => onStatus('ARCHIVEE')}><Archive size={13} />Archiver</Button>
          )}
        </div>}
      </div>
    </div>
  )
}

function AmountPill({ label, value }: { label: string; value?: number }) {
  if (value == null) return null
  return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-[#E8F5E8] text-[#1A6B1A]">{label} {formatAmount(value)}</span>
}

function serializeForm(form: RubriqueForm) {
  return {
    ...form,
    fiscalYear: Number(form.fiscalYear),
    openDate: new Date(form.openDate).toISOString(),
    closeDate: form.closeDate ? new Date(form.closeDate).toISOString() : undefined,
    amountTravailleur: toNumber(form.amountTravailleur),
    amountEtudiant: toNumber(form.amountEtudiant),
    amountCouple: toNumber(form.amountCouple),
    targetAmount: toNumber(form.targetAmount),
  }
}

function toNumber(value: string): number | undefined {
  const n = Number(value)
  return value.trim() === '' || Number.isNaN(n) ? undefined : n
}

function toStringValue(value?: number): string {
  return value == null ? '' : String(value)
}

function toDateInput(date: string): string {
  return new Date(date).toISOString().slice(0, 10)
}

function Input({ label, value, onChange, type = 'text', required }: {
  label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-600">{label}</span>
      <input type={type} required={required} value={value} onChange={e => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30" />
    </label>
  )
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void; options: string[]
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-600">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30">
        {options.map(option => <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>)}
      </select>
    </label>
  )
}
