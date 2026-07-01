'use client'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Download, Edit3, FileUp, Heart, HeartOff,
  Plus, Search, Users, X,
} from 'lucide-react'
import api from '@/lib/api'
import { cn, formatDate, getInitials } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Membre } from '@/types'

const GROUPES    = ['TEMPLE', 'MVOG_BETSI', 'BISCUITERIE', 'OBILI', 'SCIENCES', 'POLYTECHNIQUE']
const CATEGORIES = ['MCE_EN_SERVICE', 'ENFANTS', 'DIASPORA']
const STATUTS    = ['EN_OBSERVATION', 'EN_SUIVI', 'FIN_DE_SUIVI', 'DIASPORA']
const PROFILS    = ['TRAVAILLEUR', 'ETUDIANT', 'COUPLE']

const GROUPE_LABELS: Record<string, string> = {
  TEMPLE: 'Temple', MVOG_BETSI: 'Mvog Betsi', BISCUITERIE: 'Biscuiterie',
  OBILI: 'Obili', SCIENCES: 'Sciences', POLYTECHNIQUE: 'Polytechnique',
}

const emptyForm = {
  firstName: '', lastName: '', email: '', phone: '',
  adresse: '', profession: '', notes: '',
  dateAdhesion:  new Date().toISOString().slice(0, 10),
  dateNaissance: '',
  categorie:       'MCE_EN_SERVICE',
  groupe:          'TEMPLE',
  statut:          'EN_OBSERVATION',
  profilFinancier: 'TRAVAILLEUR',
  isActive:        true,
  // couple
  nomConjoint:    '',
  coupleMembreId: '',
}

type MemberForm = typeof emptyForm

export function Membres() {
  const queryClient = useQueryClient()
  const [search,          setSearch]          = useState('')
  const [filterGroupe,    setFilterGroupe]    = useState('')
  const [filterStatut,    setFilterStatut]    = useState('')
  const [filterProfil,    setFilterProfil]    = useState('')
  const [page,            setPage]            = useState(1)
  const [mode,       setMode]       = useState<'none' | 'create' | 'edit' | 'import'>('none')
  const [editingId,  setEditingId]  = useState<string | null>(null)
  const [form,       setForm]       = useState<MemberForm>(emptyForm)
  const [csv,        setCsv]        = useState('')
  const [error,      setError]      = useState('')

  // Recherche conjoint dans le système
  const [coupleSearch,    setCoupleSearch]    = useState('')
  const [coupleResults,   setCoupleResults]   = useState<Membre[]>([])
  const [coupleMode,      setCoupleMode]      = useState<'search' | 'manual' | 'linked'>('search')
  const [searchingCouple, setSearchingCouple] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['membres', page, search, filterGroupe, filterStatut, filterProfil],
    queryFn: async () => (await api.get('/membres', {
      params: {
        page, limit: 20,
        search: search || undefined,
        groupe: filterGroupe || undefined,
        statut: filterStatut || undefined,
        profilFinancier: filterProfil || undefined,
      },
    })).data,
  })

  const membres: Membre[]   = data?.data ?? []
  const pagination           = data?.pagination
  const parsedImport         = useMemo(() => parseCsv(csv), [csv])

  const createMembre = useMutation({
    mutationFn: async () => api.post('/membres', serializeForm(form)),
    onSuccess: resetAndRefresh, onError: showApiError,
  })
  const updateMembre = useMutation({
    mutationFn: async () => api.patch(`/membres/${editingId}`, serializeForm(form)),
    onSuccess: resetAndRefresh, onError: showApiError,
  })
  const importMembres = useMutation({
    mutationFn: async () => api.post('/membres/import', { membres: parsedImport.rows }),
    onSuccess: resetAndRefresh, onError: showApiError,
  })

  async function resetAndRefresh() {
    setForm(emptyForm); setCsv(''); setEditingId(null); setMode('none'); setError('')
    setCoupleSearch(''); setCoupleResults([]); setCoupleMode('search')
    await queryClient.invalidateQueries({ queryKey: ['membres'] })
    await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
  }
  function showApiError(err: unknown) {
    const e = err as { response?: { data?: { error?: { message?: string } } } }
    setError(e.response?.data?.error?.message ?? 'Opération impossible')
  }

  function startCreate() {
    setForm(emptyForm); setEditingId(null); setError('')
    setCoupleSearch(''); setCoupleResults([]); setCoupleMode('search')
    setMode(mode === 'create' ? 'none' : 'create')
  }

  function startEdit(m: Membre) {
    const [firstName = '', ...rest] = m.user.fullName.split(' ')
    const coupled = !!(m as Membre & { couple?: { id: string; user: { fullName: string } } }).couple
    setForm({
      firstName,
      lastName:        rest.join(' '),
      email:           m.user.email,
      phone:           m.phone ?? '',
      adresse:         (m as { adresse?: string }).adresse ?? '',
      profession:      m.profession ?? '',
      notes:           (m as { notes?: string }).notes ?? '',
      dateAdhesion:    toDateInput(m.dateAdhesion),
      dateNaissance:   m.dateNaissance ? toDateInput(m.dateNaissance) : '',
      categorie:       m.categorie,
      groupe:          m.groupe,
      statut:          m.statut,
      profilFinancier: m.profilFinancier,
      isActive:        m.isActive,
      nomConjoint:     (m as { nomConjoint?: string }).nomConjoint ?? '',
      coupleMembreId:  coupled ? ((m as { couple?: { id: string } }).couple?.id ?? '') : '',
    })
    if (coupled) {
      setCoupleMode('linked')
      const c = (m as { couple?: { user: { fullName: string } } }).couple
      setCoupleSearch(c?.user.fullName ?? '')
    } else {
      setCoupleMode('search')
      setCoupleSearch('')
    }
    setEditingId(m.id); setError(''); setMode('edit')
  }

  async function searchConjoint(q: string) {
    setCoupleSearch(q)
    if (q.length < 2) { setCoupleResults([]); return }
    setSearchingCouple(true)
    try {
      const res = await api.get('/membres/search', { params: { q } })
      setCoupleResults(res.data.data)
    } finally { setSearchingCouple(false) }
  }

  function selectConjoint(m: Membre) {
    setForm(f => ({ ...f, coupleMembreId: m.id, nomConjoint: '' }))
    setCoupleSearch(m.user.fullName)
    setCoupleMode('linked')
    setCoupleResults([])
  }

  function clearCouple() {
    setForm(f => ({ ...f, coupleMembreId: '', nomConjoint: '' }))
    setCoupleSearch(''); setCoupleResults([]); setCoupleMode('search')
  }

  const isCouple = form.profilFinancier === 'COUPLE'

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      {/* Header */}
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#2563EB]" />
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-blue-600">Annuaire</p>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Membres</h2>
            <p className="text-gray-500 text-sm mt-0.5">{pagination?.total ?? 0} membre(s) enregistré(s)</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setMode(mode === 'import' ? 'none' : 'import'); setError('') }}>
              <FileUp size={14} /> Importer
            </Button>
            <Button size="sm" onClick={startCreate}>
              {mode === 'create' ? <X size={14} /> : <Plus size={14} />}
              {mode === 'create' ? 'Fermer' : 'Ajouter'}
            </Button>
          </div>
        </div>
      </div>

      {/* Formulaire create/edit */}
      {(mode === 'create' || mode === 'edit') && (
        <form onSubmit={e => { e.preventDefault(); mode === 'create' ? createMembre.mutate() : updateMembre.mutate() }}
          className="mb-5 bg-white rounded-[18px] border border-gray-100 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-[#0F4A0F]">
              {mode === 'create' ? 'Nouveau membre' : 'Modifier le membre'}
            </h3>
            <button type="button" onClick={() => { setMode('none'); setEditingId(null); setError('') }}
              className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
          </div>

          {/* Infos personnelles */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <Input label="Prénom *" value={form.firstName} onChange={v => setForm(f => ({ ...f, firstName: v }))} required />
            <Input label="Nom *"    value={form.lastName}  onChange={v => setForm(f => ({ ...f, lastName: v }))}  required />
            <Input label="Email *"  type="email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} required />
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Téléphone (= WhatsApp)</label>
              <div className="flex gap-1.5">
                <span className="flex items-center px-2 py-2 bg-gray-100 border border-gray-200 rounded-[8px] text-xs text-gray-500 shrink-0">🇨🇲</span>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '') }))}
                  placeholder="6XXXXXXXX"
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-[8px] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30" />
              </div>
            </div>
            <Input label="Date adhésion *" type="date" value={form.dateAdhesion} onChange={v => setForm(f => ({ ...f, dateAdhesion: v }))} required />
            <Input label="Date naissance"  type="date" value={form.dateNaissance} onChange={v => setForm(f => ({ ...f, dateNaissance: v }))} />
            <Input label="Profession" value={form.profession} onChange={v => setForm(f => ({ ...f, profession: v }))} />
            <Input label="Adresse"    value={form.adresse}    onChange={v => setForm(f => ({ ...f, adresse: v }))} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Select label="Catégorie"       value={form.categorie}       onChange={v => setForm(f => ({ ...f, categorie: v }))}       options={CATEGORIES} />
            <Select label="Groupe"          value={form.groupe}          onChange={v => setForm(f => ({ ...f, groupe: v }))}          options={GROUPES} />
            <Select label="Statut"          value={form.statut}          onChange={v => setForm(f => ({ ...f, statut: v }))}          options={STATUTS} />
            <Select label="Profil financier" value={form.profilFinancier} onChange={v => setForm(f => ({ ...f, profilFinancier: v }))} options={PROFILS} />
          </div>

          {/* ── Section couple ── */}
          {isCouple && (
            <div className="rounded-[14px] border border-pink-200 bg-pink-50/50 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-pink-700">
                <Heart size={16} /> Lien conjugal
              </div>

              {coupleMode === 'linked' ? (
                <div className="flex items-center gap-2 rounded-[10px] bg-white border border-pink-200 px-3 py-2.5">
                  <Heart size={14} className="text-pink-500" />
                  <span className="text-sm font-semibold text-gray-800 flex-1">{coupleSearch}</span>
                  <span className="text-[11px] text-pink-600 bg-pink-100 px-2 py-0.5 rounded-full">Lié dans le système</span>
                  <button type="button" onClick={clearCouple} className="text-gray-400 hover:text-red-500">
                    <HeartOff size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 block mb-1.5">
                      Rechercher le/la conjoint(e) dans le système
                    </label>
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        value={coupleSearch}
                        onChange={e => searchConjoint(e.target.value)}
                        placeholder="Nom du conjoint…"
                        className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                      />
                      {searchingCouple && <Search size={12} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
                    </div>
                    {coupleResults.length > 0 && (
                      <div className="mt-1 border border-gray-200 rounded-[10px] overflow-hidden shadow-sm max-h-44 overflow-y-auto bg-white">
                        {coupleResults.map(m => (
                          <button key={m.id} type="button" onClick={() => selectConjoint(m)}
                            className="w-full text-left px-3 py-2 hover:bg-pink-50 transition-colors border-b border-gray-50 last:border-b-0">
                            <p className="text-sm font-semibold text-gray-800">{m.user.fullName}</p>
                            <p className="text-xs text-gray-400">{m.memberId} · {m.groupe} · {m.profilFinancier}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-px bg-pink-200" />
                    <span className="text-xs text-pink-400 font-medium">ou</span>
                    <div className="flex-1 h-px bg-pink-200" />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-gray-600 block mb-1">
                      Nom du/de la conjoint(e) (hors système)
                    </label>
                    <input
                      value={form.nomConjoint}
                      onChange={e => setForm(f => ({ ...f, nomConjoint: e.target.value, coupleMembreId: '' }))}
                      placeholder="Ex : Benilde Njeutchou épse Koukoua"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Format recommandé : Prénom NomMariage épse NomMari (pour les femmes mariées)
                    </p>
                  </div>
                </>
              )}

              {form.coupleMembreId && (
                <div className="text-xs text-pink-700 bg-pink-100 rounded-[8px] px-3 py-2">
                  Lors d'une contribution "Couple", le montant sera divisé automatiquement entre les deux membres (50/50).
                </div>
              )}
            </div>
          )}

          <div className="md:col-span-4">
            <label className="text-xs font-semibold text-gray-600 block mb-1">Notes</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30" />
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
            Membre actif
          </label>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-[10px] px-3 py-2">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => { setMode('none'); setEditingId(null); setError('') }}>Annuler</Button>
            <Button loading={createMembre.isPending || updateMembre.isPending}>
              {mode === 'create' ? 'Créer le membre' : 'Enregistrer'}
            </Button>
          </div>
        </form>
      )}

      {/* Import CSV */}
      {mode === 'import' && (
        <ImportPanel
          csv={csv} setCsv={setCsv}
          parsedCount={parsedImport.rows.length}
          parseError={parsedImport.error}
          apiError={error}
          loading={importMembres.isPending}
          onCancel={() => { setMode('none'); setCsv(''); setError('') }}
          onSubmit={() => importMembres.mutate()}
        />
      )}

      {/* D2 : Recherche + filter chips */}
      <div className="mb-5 space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Rechercher un membre par nom…"
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A]" />
        </div>
        {/* Chips groupe */}
        <div className="flex flex-wrap gap-1.5">
          {GROUPES.map(g => (
            <button key={g} type="button" onClick={() => { setFilterGroupe(filterGroupe === g ? '' : g); setPage(1) }}
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-semibold border transition-all',
                filterGroupe === g
                  ? 'bg-[#1A6B1A] text-white border-[#1A6B1A]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-[#1A6B1A]/40'
              )}>
              {GROUPE_LABELS[g] ?? g}
            </button>
          ))}
          {[
            { label: 'Travailleur', value: 'TRAVAILLEUR', active: 'bg-blue-600 text-white border-blue-600' },
            { label: 'Etudiant',    value: 'ETUDIANT',    active: 'bg-purple-600 text-white border-purple-600' },
            { label: 'Couple',      value: 'COUPLE',      active: 'bg-pink-600 text-white border-pink-600' },
          ].map(({ label, value, active }) => (
            <button key={value} type="button" onClick={() => { setFilterProfil(filterProfil === value ? '' : value); setPage(1) }}
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-semibold border transition-all',
                filterProfil === value ? active : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
              )}>
              {label}
            </button>
          ))}
          {[
            { label: 'En observation', value: 'EN_OBSERVATION', active: 'bg-amber-500 text-white border-amber-500' },
            { label: 'En suivi',       value: 'EN_SUIVI',       active: 'bg-green-600 text-white border-green-600' },
            { label: 'Diaspora',       value: 'DIASPORA',       active: 'bg-sky-600 text-white border-sky-600' },
          ].map(({ label, value, active }) => (
            <button key={value} type="button" onClick={() => { setFilterStatut(filterStatut === value ? '' : value); setPage(1) }}
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-semibold border transition-all',
                filterStatut === value ? active : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300'
              )}>
              {label}
            </button>
          ))}
          {(filterGroupe || filterProfil || filterStatut) && (
            <button type="button"
              onClick={() => { setFilterGroupe(''); setFilterProfil(''); setFilterStatut(''); setPage(1) }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border border-red-200 text-red-500 bg-red-50 hover:bg-red-100 transition-all">
              <X size={10} />Effacer filtres
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden shadow-[0_2px_12px_rgba(15,74,15,0.06)]">
        <div className="px-5 py-4 flex items-center justify-between"
          style={{ background: 'linear-gradient(135deg,#0F4A0F,#1A6B1A)' }}>
          <h3 className="font-display font-semibold text-white text-sm">Liste des membres</h3>
          <span className="text-white/60 text-xs bg-white/10 px-2.5 py-1 rounded-full">{pagination?.total ?? 0} au total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                {['Membre', 'Groupe', 'Catégorie', 'Profil', 'Couple', 'Statut', 'Adhésion', 'Action'].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => <SkeletonTableRow key={i} cols={8} />)
              ) : membres.length === 0 ? (
                <tr><td colSpan={8}>
                  <EmptyState icon={Users} title="Aucun membre" description="Ajoutez le premier membre ou importez une liste CSV."
                    actionLabel="Ajouter" onAction={startCreate} />
                </td></tr>
              ) : (
                membres.map(m => {
                  const mc = m as Membre & { couple?: { id: string; user: { fullName: string } }; nomConjoint?: string }
                  return (
                    <tr key={m.id} className="border-b border-gray-50 hover:bg-[#1A6B1A]/4 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-[8px] bg-[#E8F5E8] flex items-center justify-center shrink-0">
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
                      <td className="px-4 py-3 text-xs">
                        {mc.couple ? (
                          <span className="flex items-center gap-1 text-pink-600">
                            <Heart size={11} fill="currentColor" />
                            {mc.couple.user.fullName.split(' ')[0]}
                          </span>
                        ) : mc.nomConjoint ? (
                          <span className="text-gray-400 italic truncate max-w-[120px]">{mc.nomConjoint}</span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={m.statut} /></td>
                      <td className="px-4 py-3 text-xs text-gray-400">{formatDate(m.dateAdhesion)}</td>
                      <td className="px-4 py-3">
                        <Button size="sm" variant="outline" onClick={() => startEdit(m)}>
                          <Edit3 size={13} /> Modifier
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 bg-gray-50/30">
            <p className="text-xs text-gray-500">Page {pagination.page} / {pagination.totalPages} — {pagination.total} membre(s)</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-[8px] disabled:opacity-40 hover:bg-gray-100">
                ← Précédent
              </button>
              <button onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page === pagination.totalPages}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-[8px] disabled:opacity-40 hover:bg-gray-100">
                Suivant →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Import CSV ───────────────────────────────────────────────────────
function ImportPanel({ csv, setCsv, parsedCount, parseError, apiError, loading, onCancel, onSubmit }: {
  csv: string; setCsv: (v: string) => void; parsedCount: number; parseError: string
  apiError: string; loading: boolean; onCancel: () => void; onSubmit: () => void
}) {
  return (
    <div className="mb-5 bg-white rounded-[18px] border border-gray-100 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display font-semibold text-[#0F4A0F]">Importer des membres</h3>
          <p className="text-xs text-gray-500">CSV : prenom;nom;email;telephone;categorie;groupe;profil;statut;profession</p>
        </div>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
      </div>
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={downloadTemplate}>
          <Download size={13} /> Modèle CSV
        </Button>
      </div>
      <textarea value={csv} onChange={e => setCsv(e.target.value)} rows={7}
        placeholder={'prenom;nom;email;telephone;categorie;groupe;profil;statut;profession\nJean;Atangana;jean@example.com;690000000;MCE_EN_SERVICE;TEMPLE;TRAVAILLEUR;EN_OBSERVATION;Commerçant'}
        className="w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30" />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {parseError ? <span className="text-red-600">{parseError}</span> : `${parsedCount} membre(s) détecté(s)`}
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

// ─── Helpers ──────────────────────────────────────────────────────────
function serializeForm(form: MemberForm) {
  return {
    ...form,
    dateAdhesion:  form.dateAdhesion  ? new Date(form.dateAdhesion).toISOString()  : undefined,
    dateNaissance: form.dateNaissance ? new Date(form.dateNaissance).toISOString() : undefined,
    phone:         form.phone         || undefined,
    adresse:       form.adresse       || undefined,
    profession:    form.profession    || undefined,
    notes:         form.notes         || undefined,
    nomConjoint:   form.nomConjoint   || undefined,
    coupleMembreId: form.coupleMembreId || undefined,
  }
}

function toDateInput(date: string): string {
  return new Date(date).toISOString().slice(0, 10)
}

function downloadTemplate() {
  const content = 'prenom;nom;email;telephone;categorie;groupe;profil;statut;profession\r\nJean;Atangana;jean@example.com;690000000;MCE_EN_SERVICE;TEMPLE;TRAVAILLEUR;EN_OBSERVATION;Commerçant'
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = 'modele-import-membres.csv'; a.click()
  URL.revokeObjectURL(url)
}

function parseCsv(csv: string): { rows: Array<Record<string, string>>; error: string } {
  const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return { rows: [], error: '' }
  const delimiter = lines[0].includes(';') ? ';' : ','
  const headers   = lines[0].split(delimiter).map(normalizeHeader)
  const required  = ['firstName', 'lastName', 'email', 'categorie', 'groupe', 'profilFinancier', 'statut']
  const missing   = required.find(k => !headers.includes(k))
  if (missing) return { rows: [], error: `Colonne obligatoire manquante: ${missing}` }
  const rows = lines.slice(1).map(line => {
    const values = line.split(delimiter)
    const row: Record<string, string> = Object.fromEntries(headers.map((h, i) => [h, normalizeValue(h, values[i] ?? '')]))
    return { ...row, statut: row.statut || 'EN_OBSERVATION', profilFinancier: row.profilFinancier || 'TRAVAILLEUR',
      categorie: row.categorie || 'MCE_EN_SERVICE', groupe: row.groupe || 'TEMPLE' }
  })
  return { rows, error: rows.length ? '' : 'Aucune ligne à importer' }
}

function normalizeHeader(h: string): string {
  const key = h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s_-]/g, '')
  const map: Record<string, string> = {
    prenom:'firstName', firstname:'firstName', nom:'lastName', lastname:'lastName',
    email:'email', mail:'email', telephone:'phone', phone:'phone',
    categorie:'categorie', groupe:'groupe', profil:'profilFinancier',
    profilfinancier:'profilFinancier', statut:'statut', status:'statut', profession:'profession',
  }
  return map[key] ?? h
}

function normalizeValue(h: string, v: string): string {
  const c = v.trim()
  if (['categorie','groupe','profilFinancier','statut'].includes(h)) {
    return c.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, '_')
  }
  return c
}

function Input({ label, value, onChange, type='text', required }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean
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
  label: string; value: string; onChange: (v: string) => void; options: string[]
}) {
  return (
    <label className={cn('block')}>
      <span className="text-xs font-semibold text-gray-600">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30">
        {options.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
      </select>
    </label>
  )
}
