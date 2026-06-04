'use client'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Edit3, FileUp, Plus, Search, Users, X } from 'lucide-react'
import api from '@/lib/api'
import { formatDate, getInitials } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Membre } from '@/types'

const GROUPES = ['TEMPLE', 'MVOG_BETSI', 'BISCUITERIE', 'OBILI', 'SCIENCES', 'POLYTECHNIQUE']
const CATEGORIES = ['MCE_EN_SERVICE', 'ENFANTS', 'DIASPORA']
const STATUTS = ['EN_OBSERVATION', 'EN_SUIVI', 'FIN_DE_SUIVI', 'DIASPORA']
const PROFILS = ['TRAVAILLEUR', 'ETUDIANT', 'COUPLE']

const GROUPE_LABELS: Record<string, string> = {
  TEMPLE: 'Temple', MVOG_BETSI: 'Mvog Betsi', BISCUITERIE: 'Biscuiterie',
  OBILI: 'Obili', SCIENCES: 'Sciences', POLYTECHNIQUE: 'Polytechnique',
}

const emptyForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  phoneWhatsapp: '',
  adresse: '',
  profession: '',
  notes: '',
  dateAdhesion: new Date().toISOString().slice(0, 10),
  dateNaissance: '',
  categorie: 'MCE_EN_SERVICE',
  groupe: 'TEMPLE',
  statut: 'EN_OBSERVATION',
  profilFinancier: 'TRAVAILLEUR',
  isActive: true,
}

type MemberForm = typeof emptyForm

export function Membres() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [mode, setMode] = useState<'none' | 'create' | 'edit' | 'import'>('none')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<MemberForm>(emptyForm)
  const [csv, setCsv] = useState('')
  const [error, setError] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['membres', page, search],
    queryFn: async () => (await api.get('/membres', { params: { page, limit: 20, search: search || undefined } })).data,
  })

  const membres: Membre[] = data?.data ?? []
  const pagination = data?.pagination

  const parsedImport = useMemo(() => parseCsv(csv), [csv])

  const createMembre = useMutation({
    mutationFn: async () => api.post('/membres', serializeForm(form)),
    onSuccess: resetAndRefresh,
    onError: showApiError,
  })

  const updateMembre = useMutation({
    mutationFn: async () => api.patch(`/membres/${editingId}`, serializeForm(form)),
    onSuccess: resetAndRefresh,
    onError: showApiError,
  })

  const importMembres = useMutation({
    mutationFn: async () => api.post('/membres/import', { membres: parsedImport.rows }),
    onSuccess: resetAndRefresh,
    onError: showApiError,
  })

  async function resetAndRefresh() {
    setForm(emptyForm)
    setCsv('')
    setEditingId(null)
    setMode('none')
    setError('')
    await queryClient.invalidateQueries({ queryKey: ['membres'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
  }

  function showApiError(err: unknown) {
    const e = err as { response?: { data?: { error?: { message?: string } } } }
    setError(e.response?.data?.error?.message ?? 'Operation impossible')
  }

  function startCreate() {
    setForm(emptyForm)
    setEditingId(null)
    setError('')
    setMode(mode === 'create' ? 'none' : 'create')
  }

  function startEdit(membre: Membre) {
    const [firstName = '', ...rest] = membre.user.fullName.split(' ')
    setForm({
      firstName,
      lastName: rest.join(' '),
      email: membre.user.email,
      phone: membre.phone ?? '',
      phoneWhatsapp: membre.phoneWhatsapp ?? '',
      adresse: membre.adresse ?? '',
      profession: membre.profession ?? '',
      notes: membre.notes ?? '',
      dateAdhesion: toDateInput(membre.dateAdhesion),
      dateNaissance: membre.dateNaissance ? toDateInput(membre.dateNaissance) : '',
      categorie: membre.categorie,
      groupe: membre.groupe,
      statut: membre.statut,
      profilFinancier: membre.profilFinancier,
      isActive: membre.isActive,
    })
    setEditingId(membre.id)
    setError('')
    setMode('edit')
  }

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">Membres</h2>
          <p className="text-gray-500 text-sm">{pagination?.total ?? 0} membre(s) actif(s)</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { setMode(mode === 'import' ? 'none' : 'import'); setError('') }}>
            <FileUp size={14} />
            Importer
          </Button>
          <Button size="sm" onClick={startCreate}>
            {mode === 'create' ? <X size={14} /> : <Plus size={14} />}
            {mode === 'create' ? 'Fermer' : 'Ajouter un membre'}
          </Button>
        </div>
      </div>

      {(mode === 'create' || mode === 'edit') && (
        <MemberEditor
          mode={mode}
          form={form}
          setForm={setForm}
          error={error}
          loading={createMembre.isPending || updateMembre.isPending}
          onCancel={() => { setMode('none'); setEditingId(null); setError('') }}
          onSubmit={() => mode === 'create' ? createMembre.mutate() : updateMembre.mutate()}
        />
      )}

      {mode === 'import' && (
        <ImportPanel
          csv={csv}
          setCsv={setCsv}
          parsedCount={parsedImport.rows.length}
          parseError={parsedImport.error}
          apiError={error}
          loading={importMembres.isPending}
          onCancel={() => { setMode('none'); setCsv(''); setError('') }}
          onSubmit={() => importMembres.mutate()}
        />
      )}

      <div className="relative mb-5">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Rechercher un membre..."
          className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A]"
        />
      </div>

      <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                {['Membre', 'Groupe', 'Categorie', 'Profil', 'Statut', 'Adhesion', 'Action'].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => <SkeletonTableRow key={i} cols={7} />)
              ) : membres.length === 0 ? (
                <tr><td colSpan={7}>
                  <EmptyState
                    icon={Users}
                    title="Aucun membre"
                    description="Ajoute le premier membre ou importe une liste CSV."
                    actionLabel="Ajouter un membre"
                    onAction={startCreate}
                  />
                </td></tr>
              ) : (
                membres.map(m => (
                  <tr key={m.id} className="border-b border-gray-50 hover:bg-[#1A6B1A]/4 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-[8px] bg-[#E8F5E8] flex items-center justify-center flex-shrink-0">
                          <span className="text-[#1A6B1A] font-bold text-xs">{getInitials(m.user.fullName)}</span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-800">{m.user.fullName}</p>
                          <p className="text-xs text-gray-400 font-mono">{m.memberId}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{GROUPE_LABELS[m.groupe] ?? m.groupe}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{m.categorie.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{m.profilFinancier}</td>
                    <td className="px-4 py-3"><StatusBadge status={m.statut} /></td>
                    <td className="px-4 py-3 text-xs text-gray-400">{formatDate(m.dateAdhesion)}</td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="outline" onClick={() => startEdit(m)}>
                        <Edit3 size={13} />
                        Modifier
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function MemberEditor({ mode, form, setForm, error, loading, onCancel, onSubmit }: {
  mode: 'create' | 'edit'
  form: MemberForm
  setForm: (form: MemberForm) => void
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
        <h3 className="font-display font-semibold text-[#0F4A0F]">{mode === 'create' ? 'Ajouter un membre' : 'Modifier le membre'}</h3>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
      </div>
      <Input label="Prenom" value={form.firstName} onChange={firstName => setForm({ ...form, firstName })} required />
      <Input label="Nom" value={form.lastName} onChange={lastName => setForm({ ...form, lastName })} required />
      <Input label="Email" type="email" value={form.email} onChange={email => setForm({ ...form, email })} required />
      <Input label="Telephone" value={form.phone} onChange={phone => setForm({ ...form, phone })} />
      <Input label="WhatsApp" value={form.phoneWhatsapp} onChange={phoneWhatsapp => setForm({ ...form, phoneWhatsapp })} />
      <Input label="Date adhesion" type="date" value={form.dateAdhesion} onChange={dateAdhesion => setForm({ ...form, dateAdhesion })} required />
      <Input label="Date naissance" type="date" value={form.dateNaissance} onChange={dateNaissance => setForm({ ...form, dateNaissance })} />
      <Input label="Profession" value={form.profession} onChange={profession => setForm({ ...form, profession })} />
      <Select label="Categorie" value={form.categorie} onChange={categorie => setForm({ ...form, categorie })} options={CATEGORIES} />
      <Select label="Groupe" value={form.groupe} onChange={groupe => setForm({ ...form, groupe })} options={GROUPES} />
      <Select label="Statut" value={form.statut} onChange={statut => setForm({ ...form, statut })} options={STATUTS} />
      <Select label="Profil financier" value={form.profilFinancier} onChange={profilFinancier => setForm({ ...form, profilFinancier })} options={PROFILS} />
      <Input label="Adresse" value={form.adresse} onChange={adresse => setForm({ ...form, adresse })} />
      <label className="md:col-span-3 block">
        <span className="text-xs font-semibold text-gray-600">Notes</span>
        <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30" />
      </label>
      <label className="md:col-span-4 inline-flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />
        Membre actif
      </label>
      {error && <p className="md:col-span-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-[10px] px-3 py-2">{error}</p>}
      <div className="md:col-span-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Annuler</Button>
        <Button loading={loading}>{mode === 'create' ? 'Creer le membre' : 'Enregistrer les changements'}</Button>
      </div>
    </form>
  )
}

function ImportPanel({ csv, setCsv, parsedCount, parseError, apiError, loading, onCancel, onSubmit }: {
  csv: string
  setCsv: (value: string) => void
  parsedCount: number
  parseError: string
  apiError: string
  loading: boolean
  onCancel: () => void
  onSubmit: () => void
}) {
  return (
    <div className="mb-5 bg-white rounded-[18px] border border-gray-100 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display font-semibold text-[#0F4A0F]">Importer des membres</h3>
          <p className="text-xs text-gray-500">CSV avec en-tete: firstName,lastName,email,phone,categorie,groupe,profilFinancier,statut,profession</p>
        </div>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
      </div>
      <textarea
        value={csv}
        onChange={e => setCsv(e.target.value)}
        rows={7}
        placeholder={'firstName,lastName,email,phone,categorie,groupe,profilFinancier,statut,profession\nJean,Atangana,jean@example.com,690000000,MCE_EN_SERVICE,TEMPLE,TRAVAILLEUR,EN_OBSERVATION,Commercant'}
        className="w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30"
      />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {parseError ? <span className="text-red-600">{parseError}</span> : `${parsedCount} membre(s) detecte(s)`}
          {apiError ? <span className="block text-red-600">{apiError}</span> : null}
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Annuler</Button>
          <Button disabled={!!parseError || parsedCount === 0} loading={loading} onClick={onSubmit}>Importer</Button>
        </div>
      </div>
    </div>
  )
}

function serializeForm(form: MemberForm) {
  return {
    ...form,
    dateAdhesion: form.dateAdhesion ? new Date(form.dateAdhesion).toISOString() : undefined,
    dateNaissance: form.dateNaissance ? new Date(form.dateNaissance).toISOString() : undefined,
    phone: form.phone || undefined,
    phoneWhatsapp: form.phoneWhatsapp || undefined,
    adresse: form.adresse || undefined,
    profession: form.profession || undefined,
    notes: form.notes || undefined,
  }
}

function parseCsv(csv: string): { rows: Array<Record<string, string>>; error: string } {
  const lines = csv.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (!lines.length) return { rows: [], error: '' }
  const headers = splitCsvLine(lines[0])
  const required = ['firstName', 'lastName', 'email', 'categorie', 'groupe', 'profilFinancier', 'statut']
  const missing = required.find(key => !headers.includes(key))
  if (missing) return { rows: [], error: `Colonne obligatoire manquante: ${missing}` }

  const rows = lines.slice(1).map(line => {
    const values = splitCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })
  return { rows, error: rows.length ? '' : 'Aucune ligne a importer' }
}

function splitCsvLine(line: string): string[] {
  return line.split(',').map(value => value.trim())
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
      <input
        type={type}
        required={required}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30"
      />
    </label>
  )
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void; options: string[]
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-600">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30"
      >
        {options.map(option => <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>)}
      </select>
    </label>
  )
}
