'use client'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, CheckCircle2, CircleDollarSign, Plus, Receipt, Search, X } from 'lucide-react'
import api from '@/lib/api'
import { cn, formatAmount, formatDate, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import type { ApiResponse, ModePaiement, Prestation, PrestationStatut } from '@/types'

const STATUS_LABELS: Record<PrestationStatut, string> = {
  EN_PREPARATION: 'En preparation',
  EN_COURS: 'En cours',
  ENTREES_COMPLETES: 'Entrees completes',
  COMMISSION_VERSEE: 'Commission versee',
  CLOTURE: 'Cloturee',
}

const emptyPrestation = {
  titre: '',
  commanditaire: '',
  commanditairePhone: '',
  tarifBase: '',
  rabaisCommanditaire: '0',
  commissionPercent: '35',
  dateEvenement: '',
  lieu: '',
  description: '',
}

const emptyLine = {
  libelle: '',
  montant: '',
  modePaiement: 'ESPECES' as ModePaiement,
  reference: '',
}

export function Prestations() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyPrestation)
  const [cours, setCours] = useState(emptyLine)
  const [entree, setEntree] = useState(emptyLine)
  const [error, setError] = useState('')

  const { data = [], isLoading } = useQuery({
    queryKey: ['prestations'],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Prestation[]>>('/prestations')
      return res.data.data ?? []
    },
  })

  const selectedIdSafe = selectedId ?? data[0]?.id
  const { data: selected } = useQuery({
    queryKey: ['prestation', selectedIdSafe],
    enabled: Boolean(selectedIdSafe),
    queryFn: async () => {
      const res = await api.get<ApiResponse<Prestation>>(`/prestations/${selectedIdSafe}`)
      return res.data.data!
    },
  })

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return data.filter(item =>
      item.titre.toLowerCase().includes(q) ||
      item.reference.toLowerCase().includes(q) ||
      item.commanditaire.toLowerCase().includes(q)
    )
  }, [data, search])

  const create = useMutation({
    mutationFn: async () => api.post('/prestations', serializePrestation(form)),
    onSuccess: async (res) => {
      setShowCreate(false)
      setForm(emptyPrestation)
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['prestations'] })
      setSelectedId(res.data.data.id)
    },
    onError: showApiError,
  })

  const addCours = useMutation({
    mutationFn: async () => api.post(`/prestations/${selected?.id}/cours`, serializeLine(cours)),
    onSuccess: refreshSelected,
    onError: showApiError,
  })

  const addEntree = useMutation({
    mutationFn: async () => api.post(`/prestations/${selected?.id}/entrees`, serializeLine(entree)),
    onSuccess: refreshSelected,
    onError: showApiError,
  })

  const closeEntrees = useMutation({
    mutationFn: async () => api.patch(`/prestations/${selected?.id}/close-entrees`),
    onSuccess: refreshSelected,
    onError: showApiError,
  })

  const payCommission = useMutation({
    mutationFn: async () => api.patch(`/prestations/${selected?.id}/pay-commission`),
    onSuccess: refreshSelected,
    onError: showApiError,
  })

  async function refreshSelected() {
    setCours(emptyLine)
    setEntree(emptyLine)
    setError('')
    await queryClient.invalidateQueries({ queryKey: ['prestations'] })
    await queryClient.invalidateQueries({ queryKey: ['prestation', selectedIdSafe] })
  }

  function showApiError(err: unknown) {
    const e = err as { response?: { data?: { error?: { message?: string } } } }
    setError(e.response?.data?.error?.message ?? 'Operation impossible')
  }

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">Prestations de Genie</h2>
          <p className="text-gray-500 text-sm">Tarification, depenses, entrees et commissions</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? <X size={14} /> : <Plus size={14} />}
          {showCreate ? 'Fermer' : 'Nouvelle prestation'}
        </Button>
      </div>

      {showCreate && (
        <form onSubmit={e => { e.preventDefault(); create.mutate() }} className="mb-5 rounded-[18px] border border-gray-100 bg-white p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <Input label="Titre" value={form.titre} onChange={titre => setForm({ ...form, titre })} required />
          <Input label="Commanditaire" value={form.commanditaire} onChange={commanditaire => setForm({ ...form, commanditaire })} required />
          <Input label="Telephone" value={form.commanditairePhone} onChange={commanditairePhone => setForm({ ...form, commanditairePhone })} />
          <Input label="Lieu" value={form.lieu} onChange={lieu => setForm({ ...form, lieu })} />
          <Input label="Tarif base" type="number" value={form.tarifBase} onChange={tarifBase => setForm({ ...form, tarifBase })} required />
          <Input label="Rabais" type="number" value={form.rabaisCommanditaire} onChange={rabaisCommanditaire => setForm({ ...form, rabaisCommanditaire })} />
          <Input label="Commission %" type="number" value={form.commissionPercent} onChange={commissionPercent => setForm({ ...form, commissionPercent })} />
          <Input label="Date evenement" type="date" value={form.dateEvenement} onChange={dateEvenement => setForm({ ...form, dateEvenement })} />
          <Input label="Description" value={form.description} onChange={description => setForm({ ...form, description })} className="md:col-span-4" />
          <div className="md:col-span-4 flex justify-end">
            <Button loading={create.isPending}>Creer</Button>
          </div>
        </form>
      )}

      {error && <div className="mb-4 rounded-[10px] border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5">
        <section className="rounded-[18px] border border-gray-100 bg-white overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..."
                className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30" />
            </div>
          </div>
          <div className="max-h-[680px] overflow-y-auto">
            {isLoading ? (
              <table className="w-full"><tbody>{Array.from({ length: 6 }).map((_, i) => <SkeletonTableRow key={i} cols={3} />)}</tbody></table>
            ) : filtered.length === 0 ? (
              <EmptyState icon={Receipt} title="Aucune prestation" description="Creez une prestation pour suivre les entrees et les depenses." />
            ) : filtered.map(item => (
              <button key={item.id} onClick={() => setSelectedId(item.id)}
                className={cn('w-full text-left p-4 border-b border-gray-100 hover:bg-[#F2FFF4] transition-colors', selectedIdSafe === item.id && 'bg-[#F2FFF4]')}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-[11px] text-gray-400">{item.reference}</p>
                    <h3 className="font-semibold text-gray-800">{item.titre}</h3>
                    <p className="text-xs text-gray-500">{item.commanditaire}</p>
                  </div>
                  <Status status={item.statut} />
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-gray-500">Solde</span>
                  <span className="font-mono font-bold text-[#1A6B1A]">{formatAmount(item.solde)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {selected ? (
          <PrestationDetail
            prestation={selected}
            cours={cours}
            setCours={setCours}
            entree={entree}
            setEntree={setEntree}
            addCours={() => addCours.mutate()}
            addEntree={() => addEntree.mutate()}
            closeEntrees={() => closeEntrees.mutate()}
            payCommission={() => payCommission.mutate()}
            loading={addCours.isPending || addEntree.isPending || closeEntrees.isPending || payCommission.isPending}
          />
        ) : (
          <div className="rounded-[18px] border border-gray-100 bg-white">
            <EmptyState icon={Receipt} title="Selectionnez une prestation" description="Le detail apparaitra ici." />
          </div>
        )}
      </div>
    </div>
  )
}

function PrestationDetail({ prestation: p, cours, setCours, entree, setEntree, addCours, addEntree, closeEntrees, payCommission, loading }: {
  prestation: Prestation
  cours: typeof emptyLine
  setCours: (value: typeof emptyLine) => void
  entree: typeof emptyLine
  setEntree: (value: typeof emptyLine) => void
  addCours: () => void
  addEntree: () => void
  closeEntrees: () => void
  payCommission: () => void
  loading: boolean
}) {
  const commissionPreview = Math.round(Math.max(0, p.tarifFinal - p.totalCours) * (p.commissionPercent / 100))
  const canEditMoney = !['ENTREES_COMPLETES', 'COMMISSION_VERSEE', 'CLOTURE'].includes(p.statut)

  return (
    <section className="space-y-5">
      <div className="rounded-[18px] border border-gray-100 bg-white p-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-gray-400">{p.reference}</p>
            <h3 className="font-display font-semibold text-[#0F4A0F] text-xl">{p.titre}</h3>
            <p className="text-sm text-gray-500">{p.commanditaire}{p.lieu ? ` - ${p.lieu}` : ''}</p>
            {p.dateEvenement && <p className="text-xs text-gray-400 mt-1">Evenement: {formatDate(p.dateEvenement)}</p>}
          </div>
          <Status status={p.statut} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <Kpi label="Tarif final" value={formatAmount(p.tarifFinal)} />
          <Kpi label="Entrees" value={formatAmount(p.totalEntrees)} />
          <Kpi label="Cours" value={formatAmount(p.totalCours)} />
          <Kpi label="Solde" value={formatAmount(p.solde)} tone={p.solde > 0 ? 'warning' : 'success'} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <LinePanel title="Cours / depenses" icon={Banknote}>
          {canEditMoney && (
            <form onSubmit={e => { e.preventDefault(); addCours() }} className="grid grid-cols-1 sm:grid-cols-[1fr_130px_auto] gap-2 mb-4">
              <Input label="Libelle" value={cours.libelle} onChange={libelle => setCours({ ...cours, libelle })} required />
              <Input label="Montant" type="number" value={cours.montant} onChange={montant => setCours({ ...cours, montant })} required />
              <Button className="self-end" loading={loading}><Plus size={14} /></Button>
            </form>
          )}
          <LineList items={p.cours ?? []} />
        </LinePanel>

        <LinePanel title="Entrees" icon={CircleDollarSign}>
          {canEditMoney && (
            <form onSubmit={e => { e.preventDefault(); addEntree() }} className="grid grid-cols-1 sm:grid-cols-[1fr_120px_140px_auto] gap-2 mb-4">
              <Input label="Libelle" value={entree.libelle} onChange={libelle => setEntree({ ...entree, libelle })} required />
              <Input label="Montant" type="number" value={entree.montant} onChange={montant => setEntree({ ...entree, montant })} required />
              <label className="block">
                <span className="text-xs font-semibold text-gray-600">Mode</span>
                <select value={entree.modePaiement} onChange={e => setEntree({ ...entree, modePaiement: e.target.value as ModePaiement })}
                  className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30">
                  {Object.entries(MODE_PAIEMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <Button className="self-end" loading={loading}><Plus size={14} /></Button>
            </form>
          )}
          <LineList items={p.entrees ?? []} mode />
        </LinePanel>
      </div>

      <div className="rounded-[18px] border border-gray-100 bg-white p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h3 className="font-display font-semibold text-[#0F4A0F]">Commission</h3>
          <p className="text-sm text-gray-500">
            ({formatAmount(p.tarifFinal)} - {formatAmount(p.totalCours)}) x {p.commissionPercent}% = {formatAmount(p.commission ?? commissionPreview)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={p.totalEntrees < p.tarifFinal || p.statut !== 'EN_COURS'} loading={loading} onClick={closeEntrees}>
            <CheckCircle2 size={16} />
            Cloturer entrees
          </Button>
          <Button variant="yellow" disabled={p.statut !== 'ENTREES_COMPLETES'} loading={loading} onClick={payCommission}>
            <Receipt size={16} />
            Verser commission
          </Button>
        </div>
      </div>
    </section>
  )
}

function LinePanel({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-[18px] border border-gray-100 bg-white p-4">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#E8F5E8] text-[#1A6B1A]"><Icon size={18} /></div>
        <h3 className="font-display font-semibold text-[#0F4A0F]">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function LineList({ items, mode }: { items: Array<{ id: string; libelle: string; montant: number; modePaiement?: ModePaiement; createdAt: string }>; mode?: boolean }) {
  if (items.length === 0) return <p className="text-sm text-gray-400">Aucune ligne pour le moment.</p>
  return (
    <div className="space-y-2">
      {items.map(item => (
        <div key={item.id} className="flex items-center justify-between gap-3 rounded-[10px] bg-gray-50 px-3 py-2">
          <div>
            <p className="text-sm font-semibold text-gray-700">{item.libelle}</p>
            <p className="text-xs text-gray-400">{mode && item.modePaiement ? MODE_PAIEMENT_LABELS[item.modePaiement] : formatDate(item.createdAt)}</p>
          </div>
          <p className="font-mono text-sm font-bold text-[#1A6B1A]">{formatAmount(item.montant)}</p>
        </div>
      ))}
    </div>
  )
}

function Kpi({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warning' | 'success' }) {
  return (
    <div className="rounded-[12px] bg-gray-50 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={cn('font-display font-bold text-xl', tone === 'warning' ? 'text-amber-600' : tone === 'success' ? 'text-[#1A6B1A]' : 'text-[#0F4A0F]')}>{value}</p>
    </div>
  )
}

function Status({ status }: { status: PrestationStatut }) {
  const tone = status === 'COMMISSION_VERSEE' || status === 'CLOTURE' ? 'bg-green-100 text-green-800' :
    status === 'ENTREES_COMPLETES' ? 'bg-blue-100 text-blue-800' :
    status === 'EN_COURS' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'
  return <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold', tone)}>{STATUS_LABELS[status]}</span>
}

function Input({ label, value, onChange, type = 'text', required, className }: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      <span className="text-xs font-semibold text-gray-600">{label}</span>
      <input type={type} required={required} value={value} onChange={e => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30" />
    </label>
  )
}

function serializePrestation(form: typeof emptyPrestation) {
  return {
    ...form,
    tarifBase: Number(form.tarifBase),
    rabaisCommanditaire: Number(form.rabaisCommanditaire),
    commissionPercent: Number(form.commissionPercent),
    dateEvenement: form.dateEvenement ? new Date(form.dateEvenement).toISOString() : undefined,
  }
}

function serializeLine(form: typeof emptyLine) {
  return {
    ...form,
    montant: Number(form.montant),
  }
}
