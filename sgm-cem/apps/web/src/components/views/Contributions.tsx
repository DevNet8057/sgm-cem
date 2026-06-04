'use client'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronsUpDown, Clock, CreditCard, Plus, X } from 'lucide-react'
import api from '@/lib/api'
import { formatAmount, formatDate, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Contribution, Membre, ModePaiement, Rubrique } from '@/types'

const initialForm = {
  membreId: '',
  rubriqueId: '',
  montant: '',
  modePaiement: 'ESPECES' as ModePaiement,
  periodeLabel: '',
  mobileMoneyPhone: '',
  referencePaiement: '',
}

export function Contributions() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['contributions', page, statusFilter],
    queryFn: async () => (await api.get('/contributions', { params: { page, limit: 20, statut: statusFilter || undefined } })).data,
  })

  const { data: membresData } = useQuery({
    queryKey: ['membres', 'select'],
    queryFn: async () => (await api.get('/membres', { params: { limit: 100 } })).data.data as Membre[],
  })

  const { data: rubriquesData } = useQuery<Rubrique[]>({
    queryKey: ['rubriques'],
    queryFn: async () => (await api.get('/rubriques')).data.data,
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
      periodeLabel: form.periodeLabel || undefined,
      mobileMoneyPhone: form.mobileMoneyPhone || undefined,
      referencePaiement: form.referencePaiement || undefined,
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
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setError(e.response?.data?.error?.message ?? 'Enregistrement impossible')
    }
  })

  const contributions: Contribution[] = data?.data ?? []
  const pagination = data?.pagination
  const pending = contributions.filter(c => c.statut === 'EN_ATTENTE_CONFIRMATION').length
  const litiges = contributions.filter(c => c.statut === 'LITIGE').length

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">Contributions</h2>
          <p className="text-gray-500 text-sm">{pagination?.total ?? 0} enregistrement(s)</p>
        </div>
        <div className="flex gap-2">
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            className="text-sm border border-gray-200 rounded-[10px] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30">
            <option value="">Tous</option>
            <option value="EN_ATTENTE_CONFIRMATION">En attente</option>
            <option value="CONFIRME">Confirme</option>
            <option value="LITIGE">Litige</option>
            <option value="ANNULE">Annule</option>
          </select>
          <Button size="sm" onClick={() => setShowForm(v => !v)}>
            {showForm ? <X size={14} /> : <Plus size={14} />}
            {showForm ? 'Fermer' : 'Paiement'}
          </Button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={e => { e.preventDefault(); createContribution.mutate() }}
          className="mb-5 bg-white rounded-[18px] border border-gray-100 p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <Select label="Membre" value={form.membreId} onChange={membreId => setForm({ ...form, membreId })}
            options={[['', 'Choisir un membre'], ...(membresData ?? []).map((m): [string, string] => [m.id, `${m.user.fullName} - ${m.memberId}`])]} />
          <Select label="Rubrique" value={form.rubriqueId} onChange={rubriqueId => setForm({ ...form, rubriqueId })}
            options={[['', 'Choisir une rubrique'], ...(rubriquesData ?? []).filter(r => r.status === 'OUVERTE').map((r): [string, string] => [r.id, `${r.code} - ${r.title}`])]} />
          <Input label="Montant" type="number" value={form.montant} onChange={montant => setForm({ ...form, montant })} required />
          <Select label="Mode" value={form.modePaiement} onChange={modePaiement => setForm({ ...form, modePaiement: modePaiement as ModePaiement })}
            options={Object.entries(MODE_PAIEMENT_LABELS)} />
          <Input label="Periode" value={form.periodeLabel} onChange={periodeLabel => setForm({ ...form, periodeLabel })} />
          <Input label="Telephone paiement" value={form.mobileMoneyPhone} onChange={mobileMoneyPhone => setForm({ ...form, mobileMoneyPhone })} />
          <Input label="Reference" value={form.referencePaiement} onChange={referencePaiement => setForm({ ...form, referencePaiement })} />
          <div className="flex items-end">
            <div className="w-full rounded-[10px] bg-[#E8F5E8] px-3 py-2 text-xs text-[#0F4A0F]">
              Attendu: <span className="font-bold font-mono">{formatAmount(expectedAmount)}</span>
            </div>
          </div>
          {error && <p className="md:col-span-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-[10px] px-3 py-2">{error}</p>}
          <div className="md:col-span-4 flex justify-end">
            <Button loading={createContribution.isPending}>Enregistrer</Button>
          </div>
        </form>
      )}

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
                {['Membre', 'Rubrique', 'Montant', 'Mode', 'Statut', 'Date'].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">
                    <span className="flex items-center gap-1">{col} <ChevronsUpDown size={10} /></span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonTableRow key={i} cols={6} />)
              ) : contributions.length === 0 ? (
                <tr><td colSpan={6}><EmptyState icon={CreditCard} title="Aucune contribution" description="Les contributions enregistrees apparaitront ici" /></td></tr>
              ) : (
                contributions.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-[#1A6B1A]/4 transition-colors group">
                    <td className="px-4 py-3"><p className="font-medium text-gray-800">{c.membre?.user.fullName ?? '-'}</p></td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{c.rubrique?.code}</td>
                    <td className="px-4 py-3"><span className="font-mono font-bold text-[#1A6B1A]">{formatAmount(c.montant)}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-500">{MODE_PAIEMENT_LABELS[c.modePaiement]}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.statut} /></td>
                    <td className="px-4 py-3 text-xs text-gray-400">{formatDate(c.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100">
            <p className="text-xs text-gray-500">Page {pagination.page} sur {pagination.totalPages} - {pagination.total} resultats</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-[8px] disabled:opacity-40 hover:bg-gray-50 transition-colors">
                Precedent
              </button>
              <button onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page === pagination.totalPages}
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-[8px] disabled:opacity-40 hover:bg-gray-50 transition-colors">
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>
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

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]>
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-600">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30">
        {options.map(([optionValue, labelText]) => <option key={optionValue || labelText} value={optionValue}>{labelText}</option>)}
      </select>
    </label>
  )
}
