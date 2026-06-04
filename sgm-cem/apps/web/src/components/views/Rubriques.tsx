'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Edit3, FolderOpen, Lock, Plus, Search, Unlock, X } from 'lucide-react'
import api from '@/lib/api'
import { formatAmount, progressGradient } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SkeletonCard } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
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
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<'none' | 'create' | 'edit'>('none')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<RubriqueForm>(emptyForm)
  const [error, setError] = useState('')

  const { data, isLoading } = useQuery<Rubrique[]>({
    queryKey: ['rubriques'],
    queryFn: async () => (await api.get('/rubriques')).data.data,
  })

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

  const rubriques = data?.filter(r =>
    r.title.toLowerCase().includes(search.toLowerCase()) ||
    r.code.toLowerCase().includes(search.toLowerCase())
  ) ?? []

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">Rubriques</h2>
          <p className="text-gray-500 text-sm">{data?.length ?? 0} rubrique(s) configuree(s)</p>
        </div>
        <Button size="sm" onClick={startCreate}>
          {mode === 'create' ? <X size={14} /> : <Plus size={14} />}
          {mode === 'create' ? 'Fermer' : 'Nouvelle rubrique'}
        </Button>
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
        />
      )}

      <div className="relative mb-5">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher une rubrique..."
          className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A]"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : rubriques.length === 0 ? (
        <EmptyState icon={FolderOpen} title="Aucune rubrique" description="Commencez par creer une rubrique de contribution" actionLabel="Creer une rubrique" onAction={startCreate} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-children">
          {rubriques.map(r => (
            <RubriqueCard
              key={r.id}
              rubrique={r}
              loadingStatus={updateStatus.isPending}
              onEdit={() => startEdit(r)}
              onStatus={(status) => updateStatus.mutate({ id: r.id, status })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RubriqueEditor({ mode, form, setForm, error, loading, onCancel, onSubmit }: {
  mode: 'create' | 'edit'
  form: RubriqueForm
  setForm: (form: RubriqueForm) => void
  error: string
  loading: boolean
  onCancel: () => void
  onSubmit: () => void
}) {
  return (
    <form
      onSubmit={e => { e.preventDefault(); onSubmit() }}
      className="mb-5 bg-white rounded-[18px] border border-gray-100 p-4 grid grid-cols-1 md:grid-cols-4 gap-3"
    >
      <div className="md:col-span-4 flex items-center justify-between">
        <h3 className="font-display font-semibold text-[#0F4A0F]">{mode === 'create' ? 'Creer une rubrique' : 'Modifier la rubrique'}</h3>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
      </div>
      <Input label="Code" value={form.code} onChange={code => setForm({ ...form, code })} required />
      <Input label="Titre" value={form.title} onChange={title => setForm({ ...form, title })} required />
      <Select label="Type" value={form.type} onChange={type => setForm({ ...form, type })} options={['REGULIERE_MENSUELLE', 'PONCTUELLE', 'URGENTE']} />
      <Select label="Priorite" value={form.priority} onChange={priority => setForm({ ...form, priority })} options={['NORMAL', 'PRIORITAIRE', 'URGENT']} />
      <Input label="Annee" type="number" value={String(form.fiscalYear)} onChange={fiscalYear => setForm({ ...form, fiscalYear: Number(fiscalYear) })} required />
      <Input label="Date ouverture" type="date" value={form.openDate} onChange={openDate => setForm({ ...form, openDate })} required />
      <Input label="Date fermeture" type="date" value={form.closeDate} onChange={closeDate => setForm({ ...form, closeDate })} />
      <Input label="Objectif" type="number" value={form.targetAmount} onChange={targetAmount => setForm({ ...form, targetAmount })} />
      <Input label="Montant travailleur" type="number" value={form.amountTravailleur} onChange={amountTravailleur => setForm({ ...form, amountTravailleur })} />
      <Input label="Montant etudiant" type="number" value={form.amountEtudiant} onChange={amountEtudiant => setForm({ ...form, amountEtudiant })} />
      <Input label="Montant couple" type="number" value={form.amountCouple} onChange={amountCouple => setForm({ ...form, amountCouple })} />
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
        <Button loading={loading}>{mode === 'create' ? 'Creer la rubrique' : 'Enregistrer les changements'}</Button>
      </div>
    </form>
  )
}

function RubriqueCard({ rubrique: r, loadingStatus, onEdit, onStatus }: {
  rubrique: Rubrique
  loadingStatus: boolean
  onEdit: () => void
  onStatus: (status: RubriqueStatut) => void
}) {
  const ratio = r.targetAmount ? (r.totalCollecte ?? 0) / r.targetAmount : 0
  const topColor = r.priority === 'URGENT' ? 'from-red-500 to-red-400' :
    r.priority === 'PRIORITAIRE' ? 'from-orange-500 to-amber-400' : 'from-[#1A6B1A] to-[#2D8C2D]'

  return (
    <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden hover:shadow-cem-lg hover:-translate-y-1 hover:border-[#1A6B1A]/30 transition-all duration-200 group">
      <div className={`h-1.5 bg-gradient-to-r ${topColor}`} />
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{r.code}</span>
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
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-gray-100 text-gray-500">Contribution libre</span>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
          <span>{r.nbContributions ?? 0} contribution(s)</span>
          <span className="font-mono font-semibold text-[#1A6B1A]">{formatAmount(r.totalCollecte)}</span>
        </div>

        {r.targetAmount && (
          <div className="mb-4">
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.min(100, ratio * 100)}%`, background: progressGradient(ratio) }} />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">{Math.round(ratio * 100)}% de {formatAmount(r.targetAmount)}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
          <Button size="sm" variant="outline" onClick={onEdit}><Edit3 size={13} />Modifier</Button>
          {r.status !== 'OUVERTE' ? (
            <Button size="sm" variant="ghost" loading={loadingStatus} onClick={() => onStatus('OUVERTE')}><Unlock size={13} />Ouvrir</Button>
          ) : (
            <Button size="sm" variant="ghost" loading={loadingStatus} onClick={() => onStatus('FERMEE')}><Lock size={13} />Fermer</Button>
          )}
          {r.status !== 'ARCHIVEE' && (
            <Button size="sm" variant="danger" loading={loadingStatus} onClick={() => onStatus('ARCHIVEE')}><Archive size={13} />Archiver</Button>
          )}
        </div>
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
