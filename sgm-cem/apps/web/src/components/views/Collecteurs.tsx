'use client'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Building2, Calendar, Check, ChevronDown, CreditCard, FolderOpen, HandCoins, Landmark, MapPin, Plus, RefreshCw, ShieldCheck, Shield, User, UserCheck, UserPlus, Wallet, X, XCircle, Loader2, Banknote } from 'lucide-react'
import api from '@/lib/api'
import { cn, formatAmount, formatDate, formatDateTime, getInitials, LOCALISATION_FONDS_LABELS, MODE_PAIEMENT_LABELS, ROLE_LABELS, TRANSFER_TYPE_LABELS } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import type { CollecteursResponse, Contribution, LocalisationFonds, TransferType, UserRole } from '@/types'

const LOCATION_LABELS: Record<string, string> = {
  CHEZ_COLLECTEUR: 'Chez collecteur',
  EN_TRANSIT: 'En transit',
  CHEZ_RESPONSABLE: 'Chez Responsable',
  REMIS_TRESORIER: 'Remis trésorier',
  EN_CAISSE: 'En caisse',
  EN_BANQUE: 'En banque',
}

type TransferMode = 'existing' | 'to_user'

export function Collecteurs() {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string[]>([])
  const [destination, setDestination] = useState<Extract<LocalisationFonds, 'EN_CAISSE' | 'EN_BANQUE'>>('EN_CAISSE')
  const [recipientId, setRecipientId] = useState('')
  const [error, setError] = useState('')
  const [transferMode, setTransferMode] = useState<TransferMode>('existing')
  // B6 — dépôt bancaire trésorier
  const [bankSelected, setBankSelected] = useState<string[]>([])
  const [referenceBordereau, setReferenceBordereau] = useState('')
  const [bankError, setBankError] = useState('')

  const { data, isLoading, refetch } = useQuery<CollecteursResponse>({
    queryKey: ['collecteurs'],
    queryFn: async () => (await api.get('/collecteurs')).data.data,
    refetchInterval: 30000,
  })

  // B6 — fonds en caisse disponibles pour dépôt bancaire (trésorier uniquement)
  const { data: caisseData, isLoading: caisseLoading } = useQuery<Contribution[]>({
    queryKey: ['contributions-en-caisse'],
    queryFn: async () => {
      const res = await api.get('/contributions', { params: { limit: 200 } })
      return (res.data.data as Contribution[]).filter(c =>
        c.statut === 'CONFIRME' &&
        (c.localisationFonds === 'REMIS_TRESORIER' || c.localisationFonds === 'EN_CAISSE')
      )
    },
    enabled: data?.myRole === 'TRESORIER' || data?.myRole === 'ADMIN',
    refetchInterval: 30000,
  })

  const myRole = (data?.myRole ?? 'MEMBRE') as UserRole
  const isCollector = myRole === 'COLLECTEUR'
  const isTreasurer = myRole === 'TRESORIER'
  const eligibleRecipients = data?.eligibleRecipients ?? []

  const transferMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.patch('/collecteurs/transfer', payload),
    onSuccess: async () => {
      setSelected([])
      setRecipientId('')
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['collecteurs'] })
      await queryClient.invalidateQueries({ queryKey: ['contributions'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setError(e.response?.data?.error?.message ?? 'Transfert impossible')
    },
  })

  const bankDepositMutation = useMutation({
    mutationFn: () => api.patch('/funds/bank-deposit', {
      contributionIds: bankSelected,
      referenceBordereau,
    }),
    onSuccess: async () => {
      setBankSelected([])
      setReferenceBordereau('')
      setBankError('')
      await queryClient.invalidateQueries({ queryKey: ['contributions-en-caisse'] })
      await queryClient.invalidateQueries({ queryKey: ['collecteurs'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setBankError(e.response?.data?.error?.message ?? 'Dépôt impossible')
    },
  })

  const claimMutation = useMutation({
    mutationFn: () => api.patch('/collecteurs/claim', {
      contributionIds: selected,
      note: 'Reception des fonds en transit',
    }),
    onSuccess: async () => {
      setSelected([])
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['collecteurs'] })
      await queryClient.invalidateQueries({ queryKey: ['contributions'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setError(e.response?.data?.error?.message ?? 'Reception impossible')
    },
  })

  const contributions = data?.contributions ?? []
  const selectedTotal = useMemo(
    () => contributions.filter(c => selected.includes(c.id)).reduce((sum, c) => sum + c.montant, 0),
    [contributions, selected]
  )

  const isPending = transferMutation.isPending || claimMutation.isPending

  function toggle(id: string) {
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  function toggleAll() {
    setSelected(current => current.length === contributions.length ? [] : contributions.map(c => c.id))
  }

  function submitTransfer() {
    setError('')
    if (transferMode === 'existing') {
      transferMutation.mutate({ contributionIds: selected, localisationFonds: destination })
    } else {
      transferMutation.mutate({ contributionIds: selected, toUserId: recipientId, note: 'Transfert direct vers destinataire' })
    }
  }

  function submitClaim() {
    setError('')
    claimMutation.mutate()
  }

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#1A6B1A]" />
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#1A6B1A]">Trésorerie</p>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Fonds Collecteurs</h2>
            <p className="text-gray-500 text-sm mt-0.5">Suivi des fonds confirmés et traçabilité des transferts</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw size={14} />
            Actualiser
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="A remettre" value={formatAmount(data?.totals.totalARemettre ?? 0)} />
        <Kpi label="Contributions" value={String(data?.totals.totalContributions ?? 0)} />
        <Kpi label="En retard" value={String(data?.totals.totalEnRetard ?? 0)} tone={(data?.totals.totalEnRetard ?? 0) > 0 ? 'warning' : 'default'} />
        <Kpi label="Delai max" value={`${data?.totals.maxRetentionDays ?? 7} jour(s)`} />
      </div>

      <MoneyFlow
        flow={data?.flow}
        selectedTotal={selectedTotal}
        destination={destination}
      />

      {(data?.summary?.length ?? 0) > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-5">
          {data!.summary.map(item => (
            <div key={item.collecteurId} className="bg-white border border-gray-100 rounded-[18px] p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-display font-semibold text-[#0F4A0F]">{item.collecteurName}</p>
                  <p className="text-xs text-gray-400">{item.collecteurEmail ?? 'Aucun email'}</p>
                </div>
                {item.nbEnRetard > 0 && <AlertTriangle size={18} className="text-amber-500" />}
              </div>
              <div className="space-y-2 text-sm">
                <MoneyRow label="Chez collecteur" value={item.totalChezCollecteur} />
                <MoneyRow label="En transit" value={item.totalEnTransit} />
                <MoneyRow label="Total" value={item.totalARemettre} strong />
              </div>
              <p className="mt-3 text-xs text-gray-400">
                {item.nbContributions} contribution(s)
                {item.oldestContributionAt ? ` - plus ancien: ${formatDate(item.oldestContributionAt)}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
          style={{ background: 'linear-gradient(135deg, #0F4A0F, #1A6B1A)' }}>
          <div>
            <h3 className="font-display font-semibold text-white text-sm">Contributions selectionnees</h3>
            <p className="text-white/60 text-xs">{selected.length} selectionnee(s), {formatAmount(selectedTotal)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isCollector ? (
              <>
                <select value={recipientId} onChange={e => setRecipientId(e.target.value)}
                  className="px-3 py-2 rounded-[10px] text-sm bg-white border-0 focus:outline-none">
                  <option value="">Transférer à...</option>
                  {eligibleRecipients.map(u => (
                    <option key={u.id} value={u.id}>{u.fullName} ({u.role})</option>
                  ))}
                </select>
                <Button variant="yellow" disabled={selected.length === 0 || !recipientId} loading={isPending} onClick={submitTransfer}>
                  <UserPlus size={14} />
                  Transférer au destinataire
                </Button>
                <Button variant="primary" disabled={selected.length === 0} loading={isPending} onClick={submitClaim}>
                  <ShieldCheck size={14} />
                  Confirmer réception
                </Button>
              </>
            ) : (
              <>
                <select value={destination} onChange={e => setDestination(e.target.value as typeof destination)}
                  className="px-3 py-2 rounded-[10px] text-sm bg-white border-0 focus:outline-none">
                  <option value="EN_CAISSE">Vers caisse</option>
                  <option value="EN_BANQUE">Vers banque</option>
                </select>
                <Button variant="yellow" disabled={selected.length === 0} loading={isPending} onClick={() => submitTransfer()}>
                  <Landmark size={14} />
                  Transferer
                </Button>
              </>
            )}
          </div>
        </div>

        {error && <div className="m-4 px-3 py-2 rounded-[10px] bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left">
                  <input type="checkbox" checked={contributions.length > 0 && selected.length === contributions.length} onChange={toggleAll} />
                </th>
                {['Membre', 'Rubrique', 'Collecteur', 'Montant', 'Mode', 'Localisation', 'Date'].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonTableRow key={i} cols={8} />)
              ) : contributions.length === 0 ? (
                <tr><td colSpan={8}><EmptyState icon={Wallet} title="Aucun fonds a reverser" description="Les contributions confirmees chez les collecteurs apparaitront ici." /></td></tr>
              ) : (
                contributions.map(c => (
                  <ContributionRow key={c.id} contribution={c} selected={selected.includes(c.id)} onToggle={() => toggle(c.id)} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* B6 : Dépôt bancaire — section trésorier */}
      {isTreasurer && (
        <div className="mt-5 bg-white rounded-[18px] border border-blue-100 overflow-hidden">
          <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
            style={{ background: 'linear-gradient(135deg, #1E3A5F, #2563EB)' }}>
            <div>
              <h3 className="font-display font-semibold text-white text-sm flex items-center gap-2">
                <Banknote size={16} /> Dépôt bancaire
              </h3>
              <p className="text-white/60 text-xs">Marquer des fonds en caisse comme déposés en banque</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={referenceBordereau}
                onChange={e => setReferenceBordereau(e.target.value)}
                placeholder="Réf. bordereau (ex: BRD-2026-001)"
                className="px-3 py-2 rounded-[10px] text-sm bg-white border-0 focus:outline-none w-64"
              />
              <Button
                variant="primary"
                disabled={bankSelected.length === 0 || !referenceBordereau.trim()}
                loading={bankDepositMutation.isPending}
                onClick={() => { setBankError(''); bankDepositMutation.mutate() }}
              >
                <Banknote size={14} />
                Déposer en banque ({bankSelected.length})
              </Button>
            </div>
          </div>
          {bankError && <div className="m-4 px-3 py-2 rounded-[10px] bg-red-50 border border-red-100 text-sm text-red-600">{bankError}</div>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={(caisseData?.length ?? 0) > 0 && bankSelected.length === (caisseData?.length ?? 0)}
                      onChange={() => setBankSelected(curr =>
                        curr.length === (caisseData?.length ?? 0) ? [] : (caisseData ?? []).map(c => c.id)
                      )}
                    />
                  </th>
                  {['Membre', 'Rubrique', 'Montant', 'Localisation', 'Date'].map(col => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {caisseLoading ? (
                  Array.from({ length: 4 }).map((_, i) => <SkeletonTableRow key={i} cols={6} />)
                ) : (caisseData?.length ?? 0) === 0 ? (
                  <tr><td colSpan={6}><EmptyState icon={Banknote} title="Aucun fonds disponible" description="Les fonds en caisse ou remis au trésorier apparaîtront ici pour dépôt." /></td></tr>
                ) : (
                  (caisseData ?? []).map(c => (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={bankSelected.includes(c.id)}
                          onChange={() => setBankSelected(curr =>
                            curr.includes(c.id) ? curr.filter(id => id !== c.id) : [...curr, c.id]
                          )}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">{c.membre?.user.fullName ?? '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        <p className="font-mono">{c.rubrique?.code}</p>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-blue-600">{formatAmount(c.montant)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{LOCATION_LABELS[c.localisationFonds ?? ''] ?? '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{formatDate(c.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {(caisseData?.length ?? 0) > 0 && (
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-sm">
              <span className="text-gray-500">{bankSelected.length} sélectionné(s)</span>
              <span className="font-mono font-bold text-blue-600">
                {formatAmount((caisseData ?? []).filter(c => bankSelected.includes(c.id)).reduce((sum, c) => sum + c.montant, 0))} FCFA
              </span>
            </div>
          )}
        </div>
      )}

      <TraceSection />
    </div>
  )
}

function MoneyFlow({ flow, selectedTotal, destination }: {
  flow?: CollecteursResponse['flow']
  selectedTotal: number
  destination: Extract<LocalisationFonds, 'EN_CAISSE' | 'EN_BANQUE'>
}) {
  const toCaisse = destination === 'EN_CAISSE'
  const toBanque = destination === 'EN_BANQUE'

  return (
    <div className="mb-5 rounded-[18px] border border-gray-100 bg-white p-4 overflow-hidden">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 mb-4">
        <div>
          <h3 className="font-display font-semibold text-[#0F4A0F] text-lg">Trajet de l'argent</h3>
          <p className="text-xs text-gray-500">Vision du mouvement : collecteur vers tresorier/caisse, puis banque.</p>
        </div>
        {selectedTotal > 0 && (
          <div className="rounded-[10px] bg-[#F5C400]/20 px-3 py-2 text-xs font-semibold text-[#0F4A0F]">
            Selection en mouvement : {formatAmount(selectedTotal)} vers {toBanque ? 'banque' : 'caisse'}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] gap-3 items-stretch">
        <FlowStep
          icon={HandCoins}
          label="Chez collecteurs"
          value={flow?.chezCollecteur ?? 0}
          active={selectedTotal > 0}
        />
        <FlowArrow active={selectedTotal > 0} />
        <FlowStep
          icon={RefreshCw}
          label="En transit"
          value={flow?.enTransit ?? 0}
          active={selectedTotal > 0}
          muted
        />
        <FlowArrow active={selectedTotal > 0 && toCaisse} />
        <FlowStep
          icon={ShieldCheck}
          label="Tresorier / Caisse"
          value={flow?.enCaisse ?? 0}
          active={selectedTotal > 0 && toCaisse}
        />
        <FlowArrow active={selectedTotal > 0 && toBanque} />
        <FlowStep
          icon={Building2}
          label="Banque"
          value={flow?.enBanque ?? 0}
          active={selectedTotal > 0 && toBanque}
        />
      </div>

      <div className="mt-4 h-2 rounded-full bg-gray-100 overflow-hidden flex">
        <FlowBar color="bg-amber-400" value={flow?.chezCollecteur ?? 0} total={flow?.totalConfirme ?? 0} />
        <FlowBar color="bg-blue-400" value={flow?.enTransit ?? 0} total={flow?.totalConfirme ?? 0} />
        <FlowBar color="bg-[#1A6B1A]" value={flow?.enCaisse ?? 0} total={flow?.totalConfirme ?? 0} />
        <FlowBar color="bg-[#0F4A0F]" value={flow?.enBanque ?? 0} total={flow?.totalConfirme ?? 0} />
      </div>
      <p className="mt-2 text-xs text-gray-400">Total confirme trace : {formatAmount(flow?.totalConfirme ?? 0)}</p>
    </div>
  )
}

function FlowStep({ icon: Icon, label, value, active, muted }: {
  icon: React.ElementType
  label: string
  value: number
  active?: boolean
  muted?: boolean
}) {
  return (
    <div className={cn(
      'relative rounded-[14px] border p-4 transition-all duration-300',
      active ? 'border-[#1A6B1A]/40 bg-[#F2FFF4] shadow-cem' : 'border-gray-100 bg-gray-50/70',
      muted && !active && 'opacity-80'
    )}>
      {active && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-[#F5C400] animate-ping" />}
      <div className="flex items-center gap-3">
        <div className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]',
          active ? 'bg-[#1A6B1A] text-white' : 'bg-white text-[#1A6B1A]'
        )}>
          <Icon size={19} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500">{label}</p>
          <p className="font-display text-xl font-bold text-[#0F4A0F] leading-tight">{formatAmount(value)}</p>
        </div>
      </div>
    </div>
  )
}

function FlowArrow({ active }: { active?: boolean }) {
  return (
    <div className="hidden lg:flex items-center justify-center">
      <div className={cn(
        'flex h-9 w-9 items-center justify-center rounded-full border transition-all duration-300',
        active ? 'border-[#F5C400] bg-[#F5C400] text-[#0F4A0F] translate-x-1' : 'border-gray-200 bg-white text-gray-300'
      )}>
        <ArrowRight size={18} />
      </div>
    </div>
  )
}

function FlowBar({ color, value, total }: { color: string; value: number; total: number }) {
  if (total <= 0 || value <= 0) return null
  return <div className={color} style={{ width: `${Math.max(4, (value / total) * 100)}%` }} />
}

function ContributionRow({ contribution, selected, onToggle }: {
  contribution: Contribution
  selected: boolean
  onToggle: () => void
}) {
  return (
    <tr className="border-b border-gray-50 hover:bg-[#1A6B1A]/4 transition-colors">
      <td className="px-4 py-3"><input type="checkbox" checked={selected} onChange={onToggle} /></td>
      <td className="px-4 py-3 font-medium text-gray-800">{contribution.membre?.user.fullName ?? '-'}</td>
      <td className="px-4 py-3 text-xs text-gray-600">
        <p className="font-mono">{contribution.rubrique?.code}</p>
        <p className="text-gray-400 truncate max-w-[160px]">{contribution.rubrique?.title}</p>
      </td>
      <td className="px-4 py-3 text-xs text-gray-500">{contribution.collecteur?.fullName ?? '-'}</td>
      <td className="px-4 py-3 font-mono font-bold text-[#1A6B1A]">{formatAmount(contribution.montant)}</td>
      <td className="px-4 py-3 text-xs text-gray-500">{MODE_PAIEMENT_LABELS[contribution.modePaiement]}</td>
      <td className="px-4 py-3 text-xs text-gray-500">{LOCATION_LABELS[contribution.localisationFonds ?? ''] ?? '-'}</td>
      <td className="px-4 py-3 text-xs text-gray-400">{formatDate(contribution.createdAt)}</td>
    </tr>
  )
}

function Kpi({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warning' }) {
  return (
    <div className={`bg-white rounded-[18px] border p-4 ${tone === 'warning' ? 'border-amber-200' : 'border-gray-100'}`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`font-display font-bold text-2xl ${tone === 'warning' ? 'text-amber-600' : 'text-[#0F4A0F]'}`}>{value}</p>
    </div>
  )
}

function MoneyRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono ${strong ? 'font-bold text-[#1A6B1A]' : 'text-gray-700'}`}>{formatAmount(value)}</span>
    </div>
  )
}

function TraceSection() {
  // TODO: read audit logs for current user/context once an audit log endpoint exists.
  return null
}
