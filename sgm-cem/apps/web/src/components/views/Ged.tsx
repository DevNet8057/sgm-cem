'use client'
import { useMemo, useState } from 'react'
import { Input as AntInput, Select as AntSelect, Upload as AntUpload } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Check, Download, FileText, FolderKanban, Plus, Search, Send, Upload, X } from 'lucide-react'
import api, { getBaseURL } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
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
  tags: '',
}

export function Ged() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [commissionId, setCommissionId] = useState('')
  const [statut, setStatut] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
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
    mutationFn: async () => {
      if (!selectedFile) throw new Error('Fichier requis')
      const fd = new FormData()
      fd.append('file', selectedFile)
      fd.append('commissionId', form.commissionId)
      fd.append('typeCode', form.typeCode)
      fd.append('titre', form.titre)
      if (form.description) fd.append('description', form.description)
      if (form.tags) fd.append('tags', JSON.stringify(form.tags.split(',').map(t => t.trim()).filter(Boolean)))
      return api.post('/commissions/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: async () => {
      setShowCreate(false)
      setForm(emptyForm)
      setSelectedFile(null)
      setError('')
      await refresh()
    },
    onError: showApiError,
  })

  function downloadDocument(id: string, fileName: string) {
    const link = document.createElement('a')
    link.href = `${getBaseURL()}/commissions/documents/${id}/download`
    link.download = fileName
    link.target = '_blank'
    link.rel = 'noopener'
    link.click()
  }

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

  function selectDocument(file: File) {
    setSelectedFile(file)
    setForm(current => ({
      ...current,
      titre: current.titre || file.name.replace(/\.[^.]+$/, ''),
    }))
  }

  function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedFile || !form.commissionId || !form.typeCode || !form.titre.trim()) {
      setError('Sélectionnez un fichier et renseignez tous les champs obligatoires.')
      return
    }
    setError('')
    create.mutate()
  }

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#0EA5E9]" />
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-sky-600">Documents</p>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">GED Commissions</h2>
            <p className="text-gray-500 text-sm mt-0.5">Soumission et validation des documents des commissions</p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? <X size={14} /> : <Plus size={14} />}
            {showCreate ? 'Fermer' : 'Nouveau document'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Commissions" value={String(commissions.length)} />
        <Kpi label="Documents" value={String(documents.length)} />
        <Kpi label="En attente" value={String(documents.filter(d => d.statut === 'EN_ATTENTE').length)} tone="warning" />
        <Kpi label="Approuves" value={String(documents.filter(d => d.statut === 'APPROUVE').length)} tone="success" />
      </div>

      {showCreate && (
        <form
          onSubmit={submitCreate}
          className="mb-5 overflow-hidden rounded-[20px] border border-white/6 bg-[#0E1C16] shadow-[0_8px_30px_rgba(0,0,0,.25)]"
        >
          <div className="border-b border-white/6 bg-[linear-gradient(135deg,#0F4A0F,#1A6B1A)] px-5 py-4">
            <h3 className="font-display text-sm font-semibold text-white">Nouvelle fiche document</h3>
          </div>

          <div className="border-b border-white/6 p-5">
            <AntUpload.Dragger
              name="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
              multiple={false}
              maxCount={1}
              showUploadList={false}
              beforeUpload={file => {
                selectDocument(file)
                return false
              }}
              className="!rounded-[14px] !border-white/10 !bg-[#081A12] transition-all duration-250 hover:!border-[#2ECC71]/60"
            >
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-[12px] bg-white/6 text-[#94A3B8] transition-colors">
                <Upload size={20} />
              </div>
              <p className="mb-1 text-sm font-semibold text-white">
                {selectedFile ? selectedFile.name : 'Glissez votre fichier ici ou cliquez'}
              </p>
              <p className="text-xs text-[#94A3B8]">
                {selectedFile
                  ? `${(selectedFile.size / 1024).toFixed(1)} Ko · ${selectedFile.type}`
                  : 'PDF, Word, Excel, Image — max 20 Mo'}
              </p>
              {selectedFile && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={event => {
                    event.stopPropagation()
                    setSelectedFile(null)
                  }}
                  className="mt-2"
                >
                  Retirer le fichier
                </Button>
              )}
            </AntUpload.Dragger>
          </div>

          <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-4">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-slate-300">
                Commission <span className="text-red-400">*</span>
              </span>
              <AntSelect
                value={form.commissionId || undefined}
                onChange={value => setForm({ ...form, commissionId: value })}
                options={commissions.map(commission => ({ value: commission.id, label: commission.nom }))}
                placeholder="Choisir"
                showSearch
                optionFilterProp="label"
                aria-required="true"
                className="w-full"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-slate-300">
                Type de document <span className="text-red-400">*</span>
              </span>
              <AntSelect
                value={form.typeCode || undefined}
                onChange={value => setForm({ ...form, typeCode: value })}
                options={types.map(type => ({ value: type.code, label: type.libelle }))}
                placeholder="Choisir"
                showSearch
                optionFilterProp="label"
                aria-required="true"
                className="w-full"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="mb-1.5 block text-[13px] font-semibold text-slate-300">
                Titre <span className="text-red-400">*</span>
              </span>
              <AntInput
                required
                value={form.titre}
                onChange={event => setForm({ ...form, titre: event.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-slate-300">Tags (virgule)</span>
              <AntInput
                value={form.tags}
                onChange={event => setForm({ ...form, tags: event.target.value })}
              />
            </label>
            <label className="block md:col-span-3">
              <span className="mb-1.5 block text-[13px] font-semibold text-slate-300">Description</span>
              <AntInput
                value={form.description}
                onChange={event => setForm({ ...form, description: event.target.value })}
              />
            </label>
            <div className="flex items-center justify-end gap-2 md:col-span-4">
              {!selectedFile && <p className="text-xs text-amber-400">Sélectionnez un fichier avant de soumettre</p>}
              <Button
                loading={create.isPending}
                disabled={!selectedFile || !form.commissionId || !form.typeCode || !form.titre.trim()}
              >
                Créer la fiche
              </Button>
            </div>
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
            <AntInput
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Rechercher un document..."
              prefix={<Search aria-hidden="true" size={14} />}
              allowClear
              className="flex-1"
            />
            <AntSelect
              value={statut || undefined}
              onChange={value => setStatut(value ?? '')}
              options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              placeholder="Tous les statuts"
              allowClear
              className="w-full md:w-52"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm table-mobile-cards">
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
                    onDownload={() => downloadDocument(document.id, document.fileName)}
                    loading={submit.isPending || approve.isPending || archive.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Modal
        open={Boolean(rejectingId)}
        onClose={() => setRejectingId(null)}
        title="Rejeter le document"
        description="Précisez le motif qui sera communiqué à la commission."
        size="md"
      >
          <form onSubmit={e => { e.preventDefault(); reject.mutate() }}>
            <AntInput.TextArea
              value={motif}
              onChange={event => setMotif(event.target.value)}
              rows={4}
              required
              placeholder="Motif du rejet"
              aria-label="Motif du rejet"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setRejectingId(null)}>Annuler</Button>
              <Button variant="danger" loading={reject.isPending}>Rejeter</Button>
            </div>
          </form>
      </Modal>
    </div>
  )
}

function DocumentRow({ document, onSubmit, onApprove, onReject, onArchive, onDownload, loading }: {
  document: Document
  onSubmit: () => void
  onApprove: () => void
  onReject: () => void
  onArchive: () => void
  onDownload: () => void
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
      <td className="px-4 py-3 text-xs text-gray-500" data-label="Commission">{document.commission?.nom ?? '-'}</td>
      <td className="px-4 py-3 text-xs text-gray-500" data-label="Type">{document.typeDocument?.libelle ?? document.typeCode}</td>
      <td className="px-4 py-3" data-label="Statut"><Status status={document.statut} /></td>
      <td className="px-4 py-3 text-xs text-gray-400" data-label="Créé le">{formatDate(document.createdAt)}</td>
      <td className="px-4 py-3" data-label="Actions">
        <div className="flex flex-wrap gap-1.5">
          <button onClick={onDownload} title="Télécharger"
            className="flex items-center gap-1 px-2 py-1.5 rounded-[8px] text-xs font-semibold text-sky-600 border border-sky-200 hover:bg-sky-50 active:scale-95 transition-all">
            <Download size={12} />
          </button>
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
