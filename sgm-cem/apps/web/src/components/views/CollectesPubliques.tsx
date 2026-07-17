'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Copy, Edit3, Megaphone, Plus, Trash2, X } from 'lucide-react'
import api from '@/lib/api'
import { cn, formatAmount, progressGradient } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { SkeletonCard } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAppStore } from '@/store/appStore'
import type { ChampPersonnalise, ChampPersonnaliseType } from '@sgm-cem/shared'

/** Ligne renvoyée par GET /collectes — vue admin/trésorier, distincte de CollectePubliqueDef (partagé). */
interface CollectePublique {
  id: string
  titre: string
  description: string | null
  publicSlug: string
  isActive: boolean
  montantMin: number | null
  montantsSuggeres: number[]
  champsPersonnalises: ChampPersonnalise[]
  createdAt: string
  rubrique: { code: string; title: string; targetAmount: number | null }
  totalCollecte: number
  nbContributions: number
  nbDraftsActifs: number
}

const CHAMP_TYPE_LABELS: Record<ChampPersonnaliseType, string> = {
  text: 'Texte',
  number: 'Nombre',
  select: 'Liste déroulante',
  date: 'Date',
  checkbox: 'Case à cocher',
}

const MAX_CHAMPS = 12
const MAX_MONTANTS = 6

const emptyForm = {
  titre: '',
  description: '',
  montantMin: '',
  montantsSuggeres: [] as string[],
  champsPersonnalises: [] as ChampPersonnalise[],
}

type CollecteForm = typeof emptyForm

export function CollectesPubliques() {
  const queryClient = useQueryClient()
  const { addToast } = useAppStore()
  const [mode, setMode] = useState<'none' | 'create' | 'edit'>('none')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CollecteForm>(emptyForm)
  const [error, setError] = useState('')

  const { data, isLoading, isError } = useQuery<CollectePublique[]>({
    queryKey: ['collectes'],
    queryFn: async () => (await api.get('/collectes')).data.data,
  })

  const createCollecte = useMutation({
    mutationFn: async () => api.post('/collectes', serializeForm(form)),
    onSuccess: () => resetAndRefresh('Collecte créée'),
    onError: showApiError,
  })

  const updateCollecte = useMutation({
    mutationFn: async () => api.patch(`/collectes/${editingId}`, serializeForm(form)),
    onSuccess: () => resetAndRefresh('Collecte modifiée'),
    onError: showApiError,
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/collectes/${id}`, { isActive }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['collectes'] }) },
    onError: (err: unknown) => addToast({ title: 'Erreur', message: extractError(err), variant: 'error' }),
  })

  async function resetAndRefresh(toastTitle: string) {
    setMode('none')
    setEditingId(null)
    setForm(emptyForm)
    setError('')
    await queryClient.invalidateQueries({ queryKey: ['collectes'] })
    addToast({ title: toastTitle, variant: 'success' })
  }

  function showApiError(err: unknown) {
    setError(extractError(err))
  }

  function startCreate() {
    setMode(mode === 'create' ? 'none' : 'create')
    setEditingId(null)
    setForm(emptyForm)
    setError('')
  }

  function startEdit(c: CollectePublique) {
    setMode('edit')
    setEditingId(c.id)
    setError('')
    setForm({
      titre: c.titre,
      description: c.description ?? '',
      montantMin: toStringValue(c.montantMin),
      montantsSuggeres: c.montantsSuggeres.map(String),
      champsPersonnalises: c.champsPersonnalises,
    })
  }

  function submit() {
    const message = validate(form)
    if (message) { setError(message); return }
    setError('')
    if (mode === 'create') createCollecte.mutate()
    else updateCollecte.mutate()
  }

  async function copyLink(c: CollectePublique) {
    const url = `${window.location.origin}/collecte/${c.publicSlug}`
    try {
      await navigator.clipboard.writeText(url)
      addToast({ title: 'Lien copié', message: url, variant: 'success' })
    } catch {
      addToast({ title: 'Copie impossible', message: 'Copiez le lien manuellement depuis la barre d’adresse.', variant: 'error' })
    }
  }

  const collectes = data ?? []

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#F5C400]" />
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-amber-600">Dons &amp; campagnes</p>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Collectes publiques</h2>
            <p className="text-gray-500 text-sm mt-0.5">{collectes.length} collecte(s) publique(s) configurée(s)</p>
          </div>
          <Button size="sm" onClick={startCreate}>
            {mode === 'create' ? <X size={14} /> : <Plus size={14} />}
            {mode === 'create' ? 'Fermer' : 'Nouvelle collecte'}
          </Button>
        </div>
      </div>

      <CollecteEditor
        open={mode === 'create' || mode === 'edit'}
        mode={mode === 'edit' ? 'edit' : 'create'}
        form={form}
        setForm={setForm}
        error={error}
        loading={createCollecte.isPending || updateCollecte.isPending}
        onClose={() => { setMode('none'); setEditingId(null); setError('') }}
        onSubmit={submit}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-page-enter">
          <div className="w-20 h-20 bg-red-50 rounded-[20px] flex items-center justify-center mb-5">
            <AlertTriangle className="text-red-400" size={32} />
          </div>
          <h3 className="font-display font-semibold text-gray-700 text-xl mb-2">Erreur de chargement</h3>
          <p className="text-gray-400 text-sm max-w-xs leading-relaxed">Impossible de récupérer les collectes publiques. Réessayez dans quelques instants.</p>
        </div>
      ) : collectes.length === 0 ? (
        <EmptyState icon={Megaphone} title="Aucune collecte publique" description="Créez la première collecte pour recevoir des dons via un lien public." actionLabel="Créer la première" onAction={startCreate} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-children">
          {collectes.map(c => (
            <CollecteCard
              key={c.id}
              collecte={c}
              toggleLoading={toggleActive.isPending}
              onEdit={() => startEdit(c)}
              onToggleActive={next => toggleActive.mutate({ id: c.id, isActive: next })}
              onCopyLink={() => copyLink(c)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CollecteCard({ collecte: c, toggleLoading, onEdit, onToggleActive, onCopyLink }: {
  collecte: CollectePublique
  toggleLoading: boolean
  onEdit: () => void
  onToggleActive: (next: boolean) => void
  onCopyLink: () => void
}) {
  const target = c.rubrique.targetAmount
  const ratio = target ? (c.totalCollecte ?? 0) / target : 0

  return (
    <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden hover:shadow-cem-lg hover:-translate-y-1 hover:border-[#1A6B1A]/30 transition-all duration-200">
      <div className={cn('h-1.5 bg-gradient-to-r', c.isActive ? 'from-[#1A6B1A] to-[#2D8C2D]' : 'from-gray-300 to-gray-200')} />
      <div className="p-5">
        <div className="flex items-start justify-between mb-3 gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{c.rubrique.code}</span>
              <span className={cn(
                'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border',
                c.isActive ? 'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]' : 'bg-[#F8FAFC] text-[#94A3B8] border-[#E2E8F0]'
              )}>
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
                {c.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <h3 className="font-display font-semibold text-gray-800 text-sm leading-tight">{c.titre}</h3>
            {c.description && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{c.description}</p>}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
          <span>{c.nbContributions} contribution(s)</span>
          <span className="font-mono font-semibold text-[#1A6B1A]">{formatAmount(c.totalCollecte)}</span>
        </div>

        {target && (
          <div className="mb-4">
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.min(100, ratio * 100)}%`, background: progressGradient(ratio) }} />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">{Math.round(ratio * 100)}% de {formatAmount(target)}</p>
          </div>
        )}

        {c.nbDraftsActifs > 0 && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-[8px] px-2 py-1 mb-3">
            {c.nbDraftsActifs} brouillon(s) en cours de saisie
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-100">
          <Button size="sm" variant="outline" onClick={onEdit}><Edit3 size={13} />Modifier</Button>
          <Button size="sm" variant="ghost" onClick={onCopyLink}><Copy size={13} />Copier le lien</Button>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-gray-400">{c.isActive ? 'Activée' : 'Désactivée'}</span>
            <button
              type="button"
              disabled={toggleLoading}
              onClick={() => onToggleActive(!c.isActive)}
              className={cn(
                'w-9 h-5 rounded-full relative transition-colors shrink-0 disabled:opacity-50',
                c.isActive ? 'bg-[#1A6B1A]' : 'bg-gray-300'
              )}
            >
              <div className={cn(
                'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
                c.isActive ? 'translate-x-4' : 'translate-x-0.5'
              )} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CollecteEditor({ open, mode, form, setForm, error, loading, onClose, onSubmit }: {
  open: boolean
  mode: 'create' | 'edit'
  form: CollecteForm
  setForm: (form: CollecteForm) => void
  error: string
  loading: boolean
  onClose: () => void
  onSubmit: () => void
}) {
  function updateChamp(index: number, next: ChampPersonnalise) {
    setForm({ ...form, champsPersonnalises: form.champsPersonnalises.map((c, i) => i === index ? next : c) })
  }

  function addChamp() {
    if (form.champsPersonnalises.length >= MAX_CHAMPS) return
    setForm({ ...form, champsPersonnalises: [...form.champsPersonnalises, { key: '', label: '', type: 'text', required: false }] })
  }

  function removeChamp(index: number) {
    setForm({ ...form, champsPersonnalises: form.champsPersonnalises.filter((_, i) => i !== index) })
  }

  function updateMontant(index: number, value: string) {
    setForm({ ...form, montantsSuggeres: form.montantsSuggeres.map((m, i) => i === index ? value : m) })
  }

  function addMontant() {
    if (form.montantsSuggeres.length >= MAX_MONTANTS) return
    setForm({ ...form, montantsSuggeres: [...form.montantsSuggeres, ''] })
  }

  function removeMontant(index: number) {
    setForm({ ...form, montantsSuggeres: form.montantsSuggeres.filter((_, i) => i !== index) })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={mode === 'create' ? 'Créer une collecte publique' : 'Modifier la collecte'}
      description="Une rubrique est créée automatiquement pour suivre les montants collectés."
    >
      <form onSubmit={e => { e.preventDefault(); onSubmit() }} className="space-y-4">
        <Input label="Titre" value={form.titre} onChange={titre => setForm({ ...form, titre })} required />
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">Description</span>
          <textarea
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30"
          />
        </label>
        <Input label="Montant minimum (FCFA, optionnel)" type="number" value={form.montantMin} onChange={montantMin => setForm({ ...form, montantMin })} />

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-gray-600">Montants suggérés (optionnel)</span>
            <span className="text-[10px] text-gray-400">{form.montantsSuggeres.length}/{MAX_MONTANTS}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {form.montantsSuggeres.map((v, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  value={v}
                  onChange={e => updateMontant(i, e.target.value)}
                  className="w-28 px-3 py-2 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30"
                />
                <button type="button" onClick={() => removeMontant(i)} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
              </div>
            ))}
            {form.montantsSuggeres.length < MAX_MONTANTS && (
              <button type="button" onClick={addMontant}
                className="flex items-center gap-1 px-3 py-2 rounded-[10px] border border-dashed border-gray-300 text-xs font-semibold text-gray-500 hover:border-[#1A6B1A] hover:text-[#1A6B1A] transition-colors">
                <Plus size={13} /> Ajouter un montant
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-gray-600">Champs personnalisés du formulaire public</span>
            <span className="text-[10px] text-gray-400">{form.champsPersonnalises.length}/{MAX_CHAMPS}</span>
          </div>
          <div className="space-y-2">
            {form.champsPersonnalises.map((champ, i) => (
              <ChampRow key={i} champ={champ} onChange={next => updateChamp(i, next)} onRemove={() => removeChamp(i)} />
            ))}
          </div>
          {form.champsPersonnalises.length < MAX_CHAMPS && (
            <button type="button" onClick={addChamp}
              className="mt-2 flex items-center gap-1 px-3 py-2 rounded-[10px] border border-dashed border-gray-300 text-xs font-semibold text-gray-500 hover:border-[#1A6B1A] hover:text-[#1A6B1A] transition-colors">
              <Plus size={13} /> Ajouter un champ
            </button>
          )}
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-[10px] px-3 py-2">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button loading={loading}>{mode === 'create' ? 'Créer la collecte' : 'Enregistrer les changements'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function ChampRow({ champ, onChange, onRemove }: {
  champ: ChampPersonnalise
  onChange: (next: ChampPersonnalise) => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-[12px] border border-gray-200 bg-gray-50 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Libellé du champ</span>
            <input
              value={champ.label}
              onChange={e => onChange({ ...champ, label: e.target.value, key: deriveKey(e.target.value) })}
              placeholder="Ex : Nom de l'entreprise"
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30"
            />
            {champ.key && <p className="text-[10px] text-gray-400 mt-0.5">Clé : {champ.key}</p>}
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Type</span>
            <select
              value={champ.type}
              onChange={e => onChange({ ...champ, type: e.target.value as ChampPersonnaliseType })}
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30"
            >
              {(Object.keys(CHAMP_TYPE_LABELS) as ChampPersonnaliseType[]).map(type => (
                <option key={type} value={type}>{CHAMP_TYPE_LABELS[type]}</option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" onClick={onRemove}
          className="mt-5 shrink-0 w-8 h-8 flex items-center justify-center rounded-[8px] text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors">
          <Trash2 size={15} />
        </button>
      </div>

      {champ.type === 'select' && (
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">Options (une par ligne)</span>
          <textarea
            value={(champ.options ?? []).join('\n')}
            onChange={e => onChange({ ...champ, options: e.target.value.split('\n') })}
            rows={3}
            placeholder={'Option 1\nOption 2'}
            className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30"
          />
        </label>
      )}

      <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
        <div
          onClick={() => onChange({ ...champ, required: !champ.required })}
          className={cn('w-9 h-5 rounded-full relative transition-colors', champ.required ? 'bg-[#1A6B1A]' : 'bg-gray-300')}
        >
          <div className={cn(
            'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
            champ.required ? 'translate-x-4' : 'translate-x-0.5'
          )} />
        </div>
        <span className="text-xs font-semibold text-gray-600">Champ obligatoire</span>
      </label>
    </div>
  )
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

/** Dérive une clé camelCase à partir du libellé saisi par l'utilisateur (ex: "Nom entreprise" -> "nomEntreprise"). */
function deriveKey(label: string): string {
  const words = label
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return ''
  return words
    .map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join('')
}

function validate(form: CollecteForm): string {
  if (!form.titre.trim()) return 'Le titre est obligatoire.'
  if (form.champsPersonnalises.some(c => !c.label.trim())) return 'Chaque champ personnalisé doit avoir un libellé.'
  if (form.champsPersonnalises.some(c => c.type === 'select' && (c.options ?? []).map(o => o.trim()).filter(Boolean).length === 0)) {
    return 'Les champs de type liste déroulante doivent avoir au moins une option.'
  }
  return ''
}

function serializeForm(form: CollecteForm) {
  return {
    titre: form.titre.trim(),
    description: form.description.trim() || undefined,
    montantMin: toNumber(form.montantMin),
    montantsSuggeres: form.montantsSuggeres.map(Number).filter(n => !Number.isNaN(n) && n > 0),
    champsPersonnalises: form.champsPersonnalises.map(c => ({
      key: deriveKey(c.label) || c.key,
      label: c.label.trim(),
      type: c.type,
      required: c.required,
      options: c.type === 'select' ? (c.options ?? []).map(o => o.trim()).filter(Boolean) : undefined,
    })),
  }
}

function toNumber(value: string): number | undefined {
  const n = Number(value)
  return value.trim() === '' || Number.isNaN(n) ? undefined : n
}

function toStringValue(value?: number | null): string {
  return value == null ? '' : String(value)
}

function extractError(err: unknown): string {
  const e = err as { response?: { data?: { error?: { message?: string } } } }
  return e.response?.data?.error?.message ?? 'Opération impossible'
}
