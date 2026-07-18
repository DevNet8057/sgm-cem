'use client'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, ChevronsUpDown, Clock, CreditCard, Eye, FileText, Filter, Loader2, MapPin, Paperclip, Plus, Search, Wand2, X } from 'lucide-react'
import api, { getBaseURL } from '@/lib/api'
import { cn, formatAmount, formatDate, formatDateTime, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ContributionStepper } from '@/components/views/ContributionStepper'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { Modal } from '@/components/ui/Modal'
import { queueContribution } from '@/lib/offlineQueue'
import type { Contribution, Membre, ModePaiement, Rubrique } from '@/types'

// getBaseURL() garantit le suffixe /api quel que soit l'environnement

const initialForm = {
  membreId: '',
  rubriqueId: '',
  montant: '',
  modePaiement: 'ESPECES' as ModePaiement,
  mobileMoneyPhone: '',
  referencePaiement: '',
  directCollection: false, // B1: collecteur encaisse directement en présentiel
}

const initialDeclareForm = {
  collecteurId: '',
  rubriqueId: '',
  montant: '',
  periodeLabel: '',
  note: '',
}

export function Contributions() {
  const queryClient = useQueryClient()
  const { addToast } = useAppStore()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [modeFilter, setModeFilter] = useState('')
  const [rubriqueFilter, setRubriqueFilter] = useState('')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showDeclare, setShowDeclare] = useState(false)
  const [showStepper, setShowStepper] = useState(false)
  const [form, setForm] = useState(initialForm)
  const [declareForm, setDeclareForm] = useState(initialDeclareForm)
  const [error, setError] = useState('')
  const [declareError, setDeclareError] = useState('')
  const [receiptLoading, setReceiptLoading] = useState<string | null>(null)
  const [timelineId, setTimelineId] = useState<string | null>(null)
  const [proofUploading, setProofUploading] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['contributions', page, statusFilter, modeFilter, rubriqueFilter, search],
    queryFn: async () => (await api.get('/contributions', {
      params: {
        page, limit: 20,
        statut: statusFilter || undefined,
        modePaiement: modeFilter || undefined,
        rubriqueId: rubriqueFilter || undefined,
        search: search || undefined,
      }
    })).data,
  })

  const { data: membresData } = useQuery({
    queryKey: ['membres', 'select'],
    queryFn: async () => (await api.get('/membres', { params: { limit: 100 } })).data.data as Membre[],
  })

  const { data: rubriquesData } = useQuery<Rubrique[]>({
    queryKey: ['rubriques'],
    queryFn: async () => (await api.get('/rubriques')).data.data,
  })

  const { data: collecteursData } = useQuery<Array<{ id: string; fullName: string; role: string }>>({
    queryKey: ['eligible-receivers'],
    queryFn: async () => (await api.get('/funds/eligible-receivers')).data.data,
    enabled: showDeclare,
  })

  const { data: timelineData, isLoading: timelineLoading } = useQuery({
    queryKey: ['contribution-timeline', timelineId],
    queryFn: async () => (await api.get(`/contributions/${timelineId}/timeline`)).data.data,
    enabled: !!timelineId,
  })

  const selectedMembre = useMemo(
    () => membresData?.find(m => m.id === form.membreId),
    [membresData, form.membreId]
  )
  const selectedRubrique = useMemo(
    () => rubriquesData?.find(r => r.id === form.rubriqueId),
    [rubriquesData, form.rubriqueId]
  )

  const expectedAmount = useMemo(() => {
    if (!selectedMembre || !selectedRubrique) return undefined
    if (selectedMembre.profilFinancier === 'ETUDIANT') return selectedRubrique.amountEtudiant
    if (selectedMembre.profilFinancier === 'COUPLE') return selectedRubrique.amountCouple
    return selectedRubrique.amountTravailleur
  }, [selectedMembre, selectedRubrique])

  const createContribution = useMutation({
    mutationFn: async () => api.post('/contributions', {
      ...form,
      montant: Number(form.montant),
      mobileMoneyPhone: form.mobileMoneyPhone || undefined,
      referencePaiement: form.referencePaiement || undefined,
      directCollection: form.directCollection,
    }),
    onSuccess: async () => {
      setForm(initialForm)
      setShowForm(false)
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['contributions'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      await queryClient.invalidateQueries({ queryKey: ['monthly-stats'] })
      await queryClient.invalidateQueries({ queryKey: ['rubriques'] })
    },
    onError: async (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      // Hors ligne — mettre en file d'attente IndexedDB
      if (!navigator.onLine || (err as { code?: string }).code === 'ERR_NETWORK') {
        try {
          await queueContribution({
            membreId: form.membreId,
            rubriqueId: form.rubriqueId,
            montant: Number(form.montant),
            modePaiement: form.modePaiement,
            directCollection: form.directCollection,
            mobileMoneyPhone: form.mobileMoneyPhone || undefined,
            referencePaiement: form.referencePaiement || undefined,
          })
          setForm(initialForm)
          setShowForm(false)
          addToast({ title: 'Hors ligne — contribution en attente', message: 'Elle sera envoyée automatiquement à la reconnexion.', variant: 'warning', duration: 6000 })
        } catch {
          setError('Impossible de mettre en file d\'attente hors ligne')
        }
        return
      }
      setError(e.response?.data?.error?.message ?? 'Enregistrement impossible')
    }
  })

  const declareMutation = useMutation({
    mutationFn: async () => api.post('/contributions/declare', {
      collecteurId: declareForm.collecteurId,
      rubriqueId: declareForm.rubriqueId,
      montant: Number(declareForm.montant),
      periodeLabel: declareForm.periodeLabel || undefined,
      note: declareForm.note || undefined,
    }),
    onSuccess: async () => {
      setDeclareForm(initialDeclareForm)
      setShowDeclare(false)
      setDeclareError('')
      await queryClient.invalidateQueries({ queryKey: ['contributions'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setDeclareError(e.response?.data?.error?.message ?? 'Déclaration impossible')
    },
  })

  async function uploadProof(contributionId: string, file: File) {
    setProofUploading(contributionId)
    try {
      const fd = new FormData()
      fd.append('proof', file)
      await api.post(`/contributions/${contributionId}/proof`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      addToast({ title: 'Preuve envoyée', message: 'La preuve de paiement a bien été enregistrée.', variant: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['contributions'] })
    } catch {
      addToast({ title: 'Erreur upload', message: 'Impossible d\'uploader la preuve.', variant: 'error' })
    } finally {
      setProofUploading(null)
    }
  }

  async function downloadReceipt(id: string, memberName?: string) {
    setReceiptLoading(id)
    try {
      const res = await api.get(`/contributions/${id}/receipt`, { responseType: 'blob' })
      const blob = new Blob([res.data], { type: 'application/pdf' })
      const filename = `Recu-CEM-${id.substring(0, 8).toUpperCase()}.pdf`

      // Web Share API (Android mobile — partager le fichier PDF directement)
      if (typeof navigator !== 'undefined' && 'share' in navigator) {
        const file = new File([blob], filename, { type: 'application/pdf' })
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ title: `Reçu SGM-CEM — ${memberName ?? 'Contribution'}`, files: [file] })
          return
        }
      }

      // Fallback : téléchargement / ouverture dans l'onglet
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch {
      // silently fail — user sees no change
    } finally {
      setReceiptLoading(null)
    }
  }

  const contributions: Contribution[] = data?.data ?? []
  const pagination = data?.pagination
  const pending = contributions.filter(c => c.statut === 'EN_ATTENTE_CONFIRMATION').length
  const litiges = contributions.filter(c => c.statut === 'LITIGE').length

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      {/* Header */}
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#1A6B1A]" />
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#1A6B1A]">Caisse</p>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Contributions</h2>
            <p className="text-gray-500 text-sm mt-0.5">{pagination?.total ?? 0} enregistrement(s)</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowAdvancedFilters(v => !v)}>
              <Filter size={14} className={showAdvancedFilters ? 'text-[#1A6B1A]' : ''} />
              Filtres
              {(statusFilter || modeFilter || rubriqueFilter) && (
                <span className="ml-1 w-4 h-4 bg-[#1A6B1A] text-white text-[9px] rounded-full flex items-center justify-center">
                  {[statusFilter, modeFilter, rubriqueFilter].filter(Boolean).length}
                </span>
              )}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowStepper(true)}>
              <Wand2 size={14} />
              Guidé
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowDeclare(v => !v); setShowForm(false) }}>
              {showDeclare ? <X size={14} /> : <MapPin size={14} />}
              {showDeclare ? 'Fermer' : 'Déclarer'}
            </Button>
            <Button size="sm" onClick={() => { setShowForm(v => !v); setShowDeclare(false) }}>
              {showForm ? <X size={14} /> : <Plus size={14} />}
              {showForm ? 'Fermer' : 'Rapide'}
            </Button>
          </div>
        </div>
      </div>

      {/* D : Query builder — chips de filtres */}
      {showAdvancedFilters && (
        <div className="mb-4 bg-white rounded-[18px] border border-gray-100 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Filtres avancés</span>
            {(statusFilter || modeFilter || rubriqueFilter) && (
              <button
                onClick={() => { setStatusFilter(''); setModeFilter(''); setRubriqueFilter(''); setPage(1) }}
                className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
              >
                <X size={11} /> Effacer tout
              </button>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2">Statut</p>
            <div className="flex flex-wrap gap-2">
              {STATUS_CHIPS.map(chip => (
                <FilterChip
                  key={chip.value}
                  label={chip.label}
                  active={statusFilter === chip.value}
                  color={chip.color}
                  activeColor={chip.activeColor}
                  onClick={() => { setStatusFilter(statusFilter === chip.value ? '' : chip.value); setPage(1) }}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2">Mode de paiement</p>
            <div className="flex flex-wrap gap-2">
              {MODE_CHIPS.map(chip => (
                <FilterChip
                  key={chip.value}
                  label={chip.label}
                  active={modeFilter === chip.value}
                  color={chip.color}
                  activeColor={chip.activeColor}
                  onClick={() => { setModeFilter(modeFilter === chip.value ? '' : chip.value); setPage(1) }}
                />
              ))}
            </div>
          </div>

          {(rubriquesData?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">Rubrique</p>
              <div className="flex flex-wrap gap-2">
                {(rubriquesData ?? []).filter(r => r.status === 'OUVERTE').map(r => (
                  <FilterChip
                    key={r.id}
                    label={r.code}
                    active={rubriqueFilter === r.id}
                    color="bg-purple-50 text-purple-600 border-purple-100"
                    activeColor="bg-purple-600 text-white border-purple-600"
                    onClick={() => { setRubriqueFilter(rubriqueFilter === r.id ? '' : r.id); setPage(1) }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Chips filtres actifs */}
      {(statusFilter || modeFilter || rubriqueFilter) && !showAdvancedFilters && (
        <div className="mb-3 flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-400">Filtres actifs :</span>
          {statusFilter && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#E8F5E8] text-[#1A6B1A] text-xs font-semibold border border-[#1A6B1A]/20">
              {STATUS_CHIPS.find(c => c.value === statusFilter)?.label}
              <button onClick={() => { setStatusFilter(''); setPage(1) }}><X size={10} /></button>
            </span>
          )}
          {modeFilter && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200">
              {MODE_PAIEMENT_LABELS[modeFilter as ModePaiement] ?? modeFilter}
              <button onClick={() => { setModeFilter(''); setPage(1) }}><X size={10} /></button>
            </span>
          )}
          {rubriqueFilter && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-50 text-purple-600 text-xs font-semibold border border-purple-200">
              {rubriquesData?.find(r => r.id === rubriqueFilter)?.code ?? 'Rubrique'}
              <button onClick={() => { setRubriqueFilter(''); setPage(1) }}><X size={10} /></button>
            </span>
          )}
        </div>
      )}

      {showForm && (
        <form onSubmit={e => { e.preventDefault(); createContribution.mutate() }}
          className="mb-5 bg-white rounded-[18px] border border-gray-100 p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <SearchableSelect label="Membre" required placeholder="Rechercher un membre…"
            value={form.membreId}
            onChange={membreId => setForm({ ...form, membreId })}
            options={(membresData ?? []).map(m => ({ value: m.id, label: m.user.fullName, sublabel: m.memberId }))}
          />
          <SearchableSelect label="Rubrique" required placeholder="Rechercher une rubrique…"
            value={form.rubriqueId}
            onChange={rubriqueId => {
              const r = rubriquesData?.find(r => r.id === rubriqueId)
              const membre = membresData?.find(m => m.id === form.membreId)
              let montant = form.montant
              if (r && membre && !montant) {
                const amt = membre.profilFinancier === 'ETUDIANT' ? r.amountEtudiant
                  : membre.profilFinancier === 'COUPLE' ? r.amountCouple : r.amountTravailleur
                if (amt != null) montant = String(amt)
              }
              setForm({ ...form, rubriqueId, montant })
            }}
            options={(rubriquesData ?? []).filter(r => r.status === 'OUVERTE').map(r => ({ value: r.id, label: r.title, sublabel: r.code }))}
          />
          <Input label="Montant" type="number" value={form.montant} onChange={montant => setForm({ ...form, montant })} required />
          <SearchableSelect label="Mode" placeholder="Rechercher un mode…"
            value={form.modePaiement}
            onChange={modePaiement => setForm({ ...form, modePaiement: (modePaiement || 'ESPECES') as ModePaiement })}
            options={Object.entries(MODE_PAIEMENT_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <Input label="Telephone paiement" value={form.mobileMoneyPhone} onChange={mobileMoneyPhone => setForm({ ...form, mobileMoneyPhone })} />
          <Input label="Reference" value={form.referencePaiement} onChange={referencePaiement => setForm({ ...form, referencePaiement })} />
          <div className="flex items-end">
            <div className="w-full rounded-[10px] bg-[#E8F5E8] px-3 py-2 text-xs text-[#0F4A0F]">
              Attendu: <span className="font-bold font-mono">{formatAmount(expectedAmount)}</span>
            </div>
          </div>
          {/* B1 : Confirmation immédiate (présentiel espèces) */}
          {form.modePaiement === 'ESPECES' && (
            <label className="md:col-span-4 flex items-center gap-2.5 cursor-pointer select-none rounded-[10px] bg-[#ECFDF5] border border-[#A7F3D0] px-4 py-3">
              <input
                type="checkbox"
                checked={form.directCollection}
                onChange={e => setForm({ ...form, directCollection: e.target.checked })}
                className="w-4 h-4 accent-[#1A6B1A]"
              />
              <div>
                <p className="text-sm font-semibold text-[#065F46]">Collecteur encaisse en présentiel</p>
                <p className="text-xs text-[#10B981]">Statut CONFIRMÉ immédiat — le membre est notifié</p>
              </div>
            </label>
          )}
          {error && <p className="md:col-span-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-[10px] px-3 py-2">{error}</p>}
          <div className="md:col-span-4 flex justify-end">
            <Button loading={createContribution.isPending}>Enregistrer</Button>
          </div>
        </form>
      )}

      {/* B2 : Formulaire de déclaration membre */}
      {showDeclare && (
        <form onSubmit={e => { e.preventDefault(); declareMutation.mutate() }}
          className="mb-5 bg-white rounded-[18px] border border-amber-100 shadow-sm p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-4 flex items-center gap-2 pb-1 border-b border-gray-100">
            <MapPin size={14} className="text-amber-500" />
            <span className="text-sm font-semibold text-gray-700">Déclarer une remise à un collecteur</span>
            <span className="ml-auto text-xs text-gray-400">Le collecteur sera notifié pour confirmer</span>
          </div>
          <SearchableSelect label="Collecteur" required placeholder="Rechercher un collecteur…"
            value={declareForm.collecteurId}
            onChange={collecteurId => setDeclareForm({ ...declareForm, collecteurId })}
            options={(collecteursData ?? []).map(u => ({ value: u.id, label: u.fullName, sublabel: u.role }))}
          />
          <SearchableSelect label="Rubrique" required placeholder="Rechercher une rubrique…"
            value={declareForm.rubriqueId}
            onChange={rubriqueId => setDeclareForm({ ...declareForm, rubriqueId })}
            options={(rubriquesData ?? []).filter(r => r.status === 'OUVERTE').map(r => ({ value: r.id, label: r.title, sublabel: r.code }))}
          />
          <Input label="Montant (FCFA)" type="number" required value={declareForm.montant} onChange={montant => setDeclareForm({ ...declareForm, montant })} />
          <Input label="Période (ex: Janv 2026)" value={declareForm.periodeLabel} onChange={periodeLabel => setDeclareForm({ ...declareForm, periodeLabel })} />
          <div className="md:col-span-4">
            <Input label="Note (optionnel)" value={declareForm.note} onChange={note => setDeclareForm({ ...declareForm, note })} />
          </div>
          {declareError && <p className="md:col-span-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-[10px] px-3 py-2">{declareError}</p>}
          <div className="md:col-span-4 flex justify-end">
            <Button loading={declareMutation.isPending} variant="yellow">Déclarer la remise</Button>
          </div>
        </form>
      )}

      {/* Recherche */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Rechercher par nom de membre ou rubrique…"
          className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A]"
        />
      </div>

      {pending > 0 && (
        <div className="mb-4 px-4 py-3 bg-yellow-50 border border-yellow-200 rounded-[12px] flex items-center gap-2 text-sm text-yellow-800">
          <Clock size={14} />
          <span>{pending} contribution(s) en attente de confirmation sur cette page</span>
        </div>
      )}
      {litiges > 0 && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-[12px] flex items-center gap-2 text-sm text-red-700">
          <AlertTriangle size={14} />
          <span>{litiges} litige(s) sur cette page</span>
        </div>
      )}

      <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden">
        <div className="px-5 py-4" style={{ background: 'linear-gradient(135deg, #0F4A0F, #1A6B1A)' }}>
          <h3 className="font-display font-semibold text-white text-sm">Liste des contributions</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                {['Membre', 'Rubrique', 'Montant', 'Mode', 'Statut', 'Date', ''].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">
                    {col ? <span className="flex items-center gap-1">{col} <ChevronsUpDown size={10} /></span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonTableRow key={i} cols={6} />)
              ) : contributions.length === 0 ? (
                <tr><td colSpan={7}><EmptyState icon={CreditCard} title="Aucune contribution" description="Les contributions enregistrees apparaitront ici" /></td></tr>
              ) : (
                contributions.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-[#1A6B1A]/4 transition-colors group">
                    <td className="px-4 py-3"><p className="font-medium text-gray-800">{c.membre?.user.fullName ?? '-'}</p></td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{c.rubrique?.code}</td>
                    <td className="px-4 py-3"><span className="font-mono font-bold text-[#1A6B1A]">{formatAmount(c.montant)}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-500">{MODE_PAIEMENT_LABELS[c.modePaiement]}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.statut} /></td>
                    <td className="px-4 py-3 text-xs text-gray-400">{formatDate(c.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setTimelineId(c.id)}
                          title="Voir la traçabilité"
                          className="flex items-center gap-1 px-2 py-1.5 rounded-[8px] text-xs font-semibold text-blue-600 border border-blue-200 hover:bg-blue-50 active:scale-95 transition-all"
                        >
                          <Activity size={11} />
                        </button>
                        {/* H7 : Upload preuve de paiement */}
                        {c.statut === 'EN_ATTENTE_CONFIRMATION' && (
                          <label
                            title={c.proofUrl ? 'Remplacer la preuve' : 'Joindre une preuve de paiement'}
                            className={cn(
                              'flex items-center gap-1 px-2 py-1.5 rounded-[8px] text-xs font-semibold border cursor-pointer active:scale-95 transition-all',
                              c.proofUrl ? 'text-green-600 border-green-200 hover:bg-green-50' : 'text-gray-500 border-gray-200 hover:bg-gray-50'
                            )}
                          >
                            {proofUploading === c.id
                              ? <Loader2 size={11} className="animate-spin" />
                              : <Paperclip size={11} />}
                            <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.pdf,.webp"
                              onChange={e => { const f = e.target.files?.[0]; if (f) uploadProof(c.id, f) }} />
                          </label>
                        )}
                        {c.statut !== 'EN_ATTENTE_CONFIRMATION' && c.proofUrl && (
                          <a
                            href={c.proofUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Voir la preuve de paiement"
                            className="flex items-center gap-1 px-2 py-1.5 rounded-[8px] text-xs font-semibold border text-green-600 border-green-200 hover:bg-green-50 transition-colors"
                          >
                            <Paperclip size={11} />
                          </a>
                        )}
                        {c.statut === 'CONFIRME' && (
                          <>
                            <button
                              onClick={() => window.open(`${getBaseURL()}/contributions/${c.id}/receipt`, '_blank')}
                              title="Afficher le reçu"
                              className="flex items-center gap-1 px-2 py-1.5 rounded-[8px] text-xs font-semibold text-[#1A6B1A] border border-[#1A6B1A]/25 hover:bg-[#E8F5E8] active:scale-95 transition-all"
                            >
                              <Eye size={11} />
                            </button>
                            <button
                              onClick={() => downloadReceipt(c.id, c.membre?.user.fullName)}
                              disabled={receiptLoading === c.id}
                              title="Télécharger / partager le reçu"
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-xs font-semibold text-[#1A6B1A] border border-[#1A6B1A]/25 hover:bg-[#E8F5E8] active:scale-95 transition-all disabled:opacity-40"
                            >
                              {receiptLoading === c.id
                                ? <Loader2 size={11} className="animate-spin" />
                                : <FileText size={11} />}
                              <span className="hidden sm:inline">Reçu</span>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100">
            <p className="text-xs text-gray-500">Page {pagination.page} sur {pagination.totalPages} — {pagination.total} résultat(s)</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-[8px] disabled:opacity-40 hover:bg-gray-100 transition-colors">
                ← Précédent
              </button>
              <button onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page === pagination.totalPages}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-[8px] disabled:opacity-40 hover:bg-gray-100 transition-colors">
                Suivant →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Stepper guidé */}
      {showStepper && (
        <ContributionStepper
          membres={membresData ?? []}
          rubriques={rubriquesData ?? []}
          onClose={() => setShowStepper(false)}
          onSuccess={() => setShowStepper(false)}
        />
      )}

      {/* B5 : Modal timeline de traçabilité */}
      {timelineId && (
        <Modal open={!!timelineId} onClose={() => setTimelineId(null)}>
          <div className="p-6 w-full max-w-lg">
            <div className="flex items-center gap-2 mb-4">
              <Activity size={18} className="text-blue-500" />
              <h3 className="font-display font-semibold text-[#0F4A0F] text-lg">Traçabilité</h3>
            </div>
            {timelineLoading ? (
              <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-[#1A6B1A]" /></div>
            ) : timelineData ? (
              <>
                <div className="mb-4 rounded-[12px] bg-gray-50 border border-gray-100 p-3 text-sm grid grid-cols-2 gap-2">
                  <span className="text-gray-500">Membre</span>
                  <span className="font-medium text-gray-800">{timelineData.contribution.membre ?? '-'}</span>
                  <span className="text-gray-500">Rubrique</span>
                  <span className="font-medium text-gray-800">{timelineData.contribution.rubrique ?? '-'}</span>
                  <span className="text-gray-500">Montant</span>
                  <span className="font-mono font-bold text-[#1A6B1A]">{formatAmount(timelineData.contribution.montant)}</span>
                  <span className="text-gray-500">Statut</span>
                  <StatusBadge status={timelineData.contribution.statut} />
                </div>
                <div className="relative">
                  <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-100" />
                  <ol className="space-y-4">
                    {(timelineData.timeline as TimelineStep[]).map((step, i) => (
                      <li key={i} className="relative flex gap-4 pl-10">
                        <div className={cn(
                          'absolute left-3 -translate-x-1/2 w-4 h-4 rounded-full border-2 flex items-center justify-center',
                          i === 0 ? 'bg-[#1A6B1A] border-[#1A6B1A]' : 'bg-white border-gray-300'
                        )}>
                          {i === 0 && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800">{step.label}</p>
                          <p className="text-xs text-gray-500">{step.actor}</p>
                          {step.at && <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(String(step.at))}</p>}
                          {step.localisation && <p className="text-xs text-blue-500 mt-0.5">{step.localisation}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </>
            ) : (
              <p className="text-center text-gray-500 py-6">Aucune donnée</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

const STATUS_CHIPS = [
  { label: 'En attente', value: 'EN_ATTENTE_CONFIRMATION', color: 'bg-amber-50 text-amber-700 border-amber-200', activeColor: 'bg-amber-500 text-white border-amber-500' },
  { label: 'Confirmé',   value: 'CONFIRME',                color: 'bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]', activeColor: 'bg-[#1A6B1A] text-white border-[#1A6B1A]' },
  { label: 'Litige',     value: 'LITIGE',                  color: 'bg-red-50 text-red-700 border-red-200',  activeColor: 'bg-red-600 text-white border-red-600' },
  { label: 'Annulé',     value: 'ANNULE',                  color: 'bg-gray-100 text-gray-500 border-gray-200', activeColor: 'bg-gray-500 text-white border-gray-500' },
] as const

const MODE_CHIPS = [
  { label: 'Espèces',     value: 'ESPECES',      color: 'bg-green-50 text-green-700 border-green-200', activeColor: 'bg-green-700 text-white border-green-700' },
  { label: 'MTN MoMo',    value: 'MTN_MOMO',     color: 'bg-yellow-50 text-yellow-700 border-yellow-200', activeColor: 'bg-[#FFCC00] text-black border-[#FFCC00]' },
  { label: 'Orange',      value: 'ORANGE_MONEY', color: 'bg-orange-50 text-orange-700 border-orange-200', activeColor: 'bg-[#FF6600] text-white border-[#FF6600]' },
  { label: 'Yelii',       value: 'YELII',        color: 'bg-purple-50 text-purple-700 border-purple-200', activeColor: 'bg-purple-600 text-white border-purple-600' },
  { label: 'Carte Visa',  value: 'CARTE_VISA',   color: 'bg-blue-50 text-blue-700 border-blue-200', activeColor: 'bg-blue-600 text-white border-blue-600' },
  { label: 'Virement',    value: 'VIREMENT',     color: 'bg-indigo-50 text-indigo-700 border-indigo-200', activeColor: 'bg-indigo-600 text-white border-indigo-600' },
] as const

function FilterChip({ label, active, color, activeColor, onClick }: {
  label: string; active: boolean; color: string; activeColor: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-150 active:scale-95',
        active ? activeColor : color
      )}
    >
      {label}
      {active && <X size={10} className="ml-0.5" />}
    </button>
  )
}

interface TimelineStep {
  step: string
  label: string
  actor: string
  at?: string | Date
  localisation?: string
  detail?: unknown
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

