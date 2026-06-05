'use client'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Check, FileText, FolderKanban, Plus, Search, Send, X } from 'lucide-react'
import api from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import type { ApiResponse, Commission, Document, DocumentStatut, TypeDocument } from '@/types'

const STATUS_LABELS: Record<DocumentStatut, string> = {
  BROUILLON: 'Brouillon',
  EN_ATTENTE: 'En attente',
  APPROUVE: 'Approuve',
  REJETE: 'Rejete',
  ARCHIVE: 'Archive',
}

const emptyForm = {
  commissionId: '',
  typeCode: '',
  titre: '',
  description: '',
  fileName: '',
  fileSize: '',
  mimeType: 'application/pdf',
  tags: '',
}

export function Ged() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [commissionId, setCommissionId] = useState('')
  const [statut, setStatut] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [motif, setMotif] = useState('')
  const [error, setError] = useState('')

  const { data: commissions = [] } = useQuery({
    queryKey: ['commissions'],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Commission[]>>('/commissions')
      return res.data.data ?? []
    },
  })

  const { data: types = [] } = useQuery({
    queryKey: ['document-types'],
    queryFn: async () => {
      const res = await api.get<ApiResponse<TypeDocument[]>>('/commissions/types')
      return res.data.data ?? []
    },
  })

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents', commissionId, statut],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (commissionId) params.set('commissionId', commissionId)
      if (statut) params.set('statut', statut)
      const res = await api.get<ApiResponse<Document[]>>(`/commissions/documents?${params}`)
      return res.data.data ?? []
    },
  })

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return documents.filter(document =>
      document.titre.toLowerCase().includes(q) ||
      document.fileName.toLowerCase().includes(q) ||
      (document.commission?.nom ?? '').toLowerCase().includes(q)
    )
  }, [documents, search])

  const create = useMutation({
    mutationFn: async () => api.post('/commissions/documents', serializeForm(form)),
    onSuccess: async () => {
      setShowCreate(false)
      setForm(emptyForm)
      setError('')
      await refresh()
    },
    onError: showApiError,
  })

  const submit = useMutation({
    mutationFn: async (id: string) => api.patch(`/commissions/documents/${id}/submit`),
    onSuccess: refresh,
    onError: showApiError,
  })

  const approve = useMutation({
    mutationFn: async (id: string) => api.patch(`/commissions/documents/${id}/approve`),
    onSuccess: refresh,
    onError: showApiError,
  })

  const reject = useMutation({
    mutationFn: async () => api.patch(`/commissions/documents/${rejectingId}/reject`, { motif }),
    onSuccess: async () => {
      setRejectingId(null)
      setMotif('')
      await refresh()
    },
    onError: showApiError,
  })

  const archive = useMutation({
    mutationFn: async (id: string) => api.patch(`/commissions/documents/${id}/archive`),
    onSuccess: refresh,
    onError: showApiError,
  })

  async function refresh() {
    setError('')
    await queryClient.invalidateQueries({ queryKey: ['documents'] })
    await queryClient.invalidateQueries({ queryKey: ['commissions'] })
  }

  function showApiError(err: unknown) {
    const e = err as { response?: { data?: { error?: { message?: string } } } }
    setError(e.response?.data?.error?.message ?? 'Operation impossible')
  }

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">GED Commissions</h2>
          <p className="text-gray-500 text-sm">Documents, soumission et validation des commissions</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? <X size={14} /> : <Plus size={14} />}
          {showCreate ? 'Fermer' : 'Nouveau document'}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Commissions" value={String(commissions.length)} />
        <Kpi label="Documents" value={String(documents.length)} />
        <Kpi label="En attente" value={String(documents.filter(d => d.statut === 'EN_ATTENTE').length)} tone="warning" />
        <Kpi label="Approuves" value={String(documents.filter(d => d.statut === 'APPROUVE').length)} tone="success" />
      </div>

      {showCreate && (
        <form onSubmit={e => { e.preventDefault(); create.mutate() }} className="mb-5 rounded-[18px] border border-gray-100 bg-white p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <Select label="Commission" value={form.commissionId} onChange={value => setForm({ ...form, commissionId: value })} required options={commissions.map(c => ({ value: c.id, label: c.nom }))} />
          <Select label="Type" value={form.typeCode} onChange={value => setForm({ ...form, typeCode: value })} required options={types.map(t => ({ value: t.code, label: t.libelle }))} />
          <Input label="Titre" value={form.titre} onChange={titre => setForm({ ...form, titre })} required />
          <Input label="Nom du fichier" value={form.fileName} onChange={fileName => setForm({ ...form, fileName })} required />
          <Input label="Taille fichier (octets)" type="number" value={form.fileSize} onChange={fileSize => setForm({ ...form, fileSize })} required />
          <Input label="MIME" value={form.mimeType} onChange={mimeType => setForm({ ...form, mimeType })} required />
          <Input label="Tags (separes par virgule)" value={form.tags} onChange={tags => setForm({ ...form, tags })} />
          <Input label="Description" value={form.description} onChange={description => setForm({ ...form, description })} className="md:col-span-4" />
          <div className="md:col-span-4 flex justify-end">
            <Button loading={create.isPending}>Creer la fiche</Button>
          </div>
        </form>
      )}

      {error && <div className="mb-4 rounded-[10px] border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-5">
        <aside className="space-y-4">
          <div className="rounded-[18px] border border-gray-100 bg-white p-4">
            <h3 className="font-display font-semibold text-[#0F4A0F] mb-3">Commissions</h3>
            <div className="space-y-2">
              <button onClick={() => setCommissionId('')} className={cn('w-full text-left rounded-[10px] px-3 py-2 text-sm hover:bg-[#F2FFF4]', commissionId === '' && 'bg-[#F2FFF4] text-[#1A6B1A] font-semibold')}>
                Toutes les commissions
              </button>
              {commissions.map(commission => (
                <button key={commission.id} onClick={() => setCommissionId(commission.id)}
                  className={cn('w-full text-left rounded-[10px] px-3 py-2 text-sm hover:bg-[#F2FFF4]', commissionId === commission.id && 'bg-[#F2FFF4] text-[#1A6B1A] font-semibold')}>
                  <span className="block truncate">{commission.nom}</span>
                  <span className="text-xs text-gray-400">{commission._count?.documents ?? 0} doc(s)</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="rounded-[18px] border border-gray-100 bg-white overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un document..."
                className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30" />
            </div>
            <select value={statut} onChange={e => setStatut(e.target.value)}
              className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30">
              <option value="">Tous les statuts</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {['Document', 'Commission', 'Type', 'Statut', 'Cree le', 'Actions'].map(col => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => <SkeletonTableRow key={i} cols={6} />)
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6}><EmptyState icon={FolderKanban} title="Aucun document" description="Les documents des commissions apparaitront ici." /></td></tr>
                ) : filtered.map(document => (
                  <DocumentRow
                    key={document.id}
                    document={document}
                    onSubmit={() => submit.mutate(document.id)}
                    onApprove={() => approve.mutate(document.id)}
                    onReject={() => setRejectingId(document.id)}
                    onArchive={() => archive.mutate(document.id)}
                    loading={submit.isPending || approve.isPending || archive.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {rejectingId && (
        <div className="fixed inset-0 z-[500] bg-black/30 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={e => { e.preventDefault(); reject.mutate() }} className="w-full max-w-md rounded-[18px] bg-white p-5 shadow-cem-xl">
            <h3 className="font-display font-semibold text-[#0F4A0F] mb-3">Rejeter le document</h3>
            <textarea value={motif} onChange={e => setMotif(e.target.value)} rows={4} required
              placeholder="Motif du rejet"
              className="w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30" />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setRejectingId(null)}>Annuler</Button>
              <Button variant="danger" loading={reject.isPending}>Rejeter</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function DocumentRow({ document, onSubmit, onApprove, onReject, onArchive, loading }: {
  document: Document
  onSubmit: () => void
  onApprove: () => void
  onReject: () => void
  onArchive: () => void
  loading: boolean
}) {
  return (
    <tr className="border-b border-gray-50 hover:bg-[#1A6B1A]/4 transition-colors align-top">
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <FileText size={18} className="mt-0.5 text-[#1A6B1A]" />
          <div>
            <p className="font-semibold text-gray-800">{document.titre}</p>
            <p className="text-xs text-gray-400">{document.fileName}</p>
            {document.rejetMotif && <p className="text-xs text-red-500 mt-1">Motif: {document.rejetMotif}</p>}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-gray-500">{document.commission?.nom ?? '-'}</td>
      <td className="px-4 py-3 text-xs text-gray-500">{document.typeDocument?.libelle ?? document.typeCode}</td>
      <td className="px-4 py-3"><Status status={document.statut} /></td>
      <td className="px-4 py-3 text-xs text-gray-400">{formatDate(document.createdAt)}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {['BROUILLON', 'REJETE'].includes(document.statut) && <Button size="sm" variant="outline" loading={loading} onClick={onSubmit}><Send size={13} />Soumettre</Button>}
          {document.statut === 'EN_ATTENTE' && <Button size="sm" loading={loading} onClick={onApprove}><Check size={13} />Approuver</Button>}
          {document.statut === 'EN_ATTENTE' && <Button size="sm" variant="danger" onClick={onReject}><X size={13} />Rejeter</Button>}
          {document.statut !== 'ARCHIVE' && <Button size="sm" variant="ghost" loading={loading} onClick={onArchive}><Archive size={13} />Archiver</Button>}
        </div>
      </td>
    </tr>
  )
}

function Kpi({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warning' | 'success' }) {
  return (
    <div className="rounded-[18px] border border-gray-100 bg-white p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={cn('font-display font-bold text-2xl', tone === 'warning' ? 'text-amber-600' : tone === 'success' ? 'text-[#1A6B1A]' : 'text-[#0F4A0F]')}>{value}</p>
    </div>
  )
}

function Status({ status }: { status: DocumentStatut }) {
  const tone = status === 'APPROUVE' ? 'bg-green-100 text-green-800' :
    status === 'EN_ATTENTE' ? 'bg-amber-100 text-amber-800' :
    status === 'REJETE' ? 'bg-red-100 text-red-700' :
    status === 'ARCHIVE' ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-800'
  return <span className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold', tone)}>{STATUS_LABELS[status]}</span>
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

function Select({ label, value, onChange, options, required }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-600">{label}</span>
      <select required={required} value={value} onChange={e => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30">
        <option value="">Choisir</option>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function serializeForm(form: typeof emptyForm) {
  return {
    ...form,
    fileSize: Number(form.fileSize),
    tags: form.tags.split(',').map(tag => tag.trim()).filter(Boolean),
  }
}
