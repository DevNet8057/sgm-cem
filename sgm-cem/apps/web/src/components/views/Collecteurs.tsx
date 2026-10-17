'use client'
import { useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Building2, Calendar, Check, ChevronDown, CreditCard, FolderOpen, HandCoins, Landmark, MapPin, Plus, RefreshCw, ShieldCheck, Shield, Smartphone, User, UserCheck, UserPlus, Wallet, X, XCircle, Loader2, Banknote } from 'lucide-react'
import api from '@/lib/api'
import { cn, formatAmount, formatDate, formatDateTime, LOCALISATION_FONDS_LABELS, MODE_PAIEMENT_LABELS, ROLE_LABELS, TRANSFER_TYPE_LABELS, contributorKind, contributorName } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { ContributorBadge } from '@/components/ui/CompactList'
import type { CollecteurSummary, CollecteursResponse, Contribution, LocalisationFonds, TransferType, UserRole } from '@/types'

const LOCATION_LABELS: Record<string, string> = {
  CHEZ_COLLECTEUR: 'Chez collecteur',
  EN_TRANSIT: 'En transit',
  CHEZ_RESPONSABLE: 'Chez Responsable',
  REMIS_TRESORIER: 'Remis trésorier',
  EN_CAISSE: 'En caisse',
  EN_BANQUE: 'En banque',
  PORTEFEUILLE_ELECTRONIQUE: 'Portefeuille électronique',
}

const DEPOSITABLE = ['REMIS_TRESORIER', 'EN_CAISSE', 'PORTEFEUILLE_ELECTRONIQUE']

export function Collecteurs() {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string[]>([])
  const [recipientId, setRecipientId] = useState('')
  const [transferType, setTransferType] = useState<TransferType>('ESPECES_EN_MAIN')
  const [error, setError] = useState('')
  // B6 — dépôt bancaire trésorier
  const [bankSelected, setBankSelected] = useState<string[]>([])
  const [referenceBordereau, setReferenceBordereau] = useState('')
  const [bankError, setBankError] = useState('')
  const [bankOpen, setBankOpen] = useState<string[]>([])

  const { data, isLoading, refetch } = useQuery<CollecteursResponse>({
    queryKey: ['collecteurs'],
    queryFn: async () => (await api.get('/collecteurs')).data.data,
    refetchInterval: 30000,
  })

  // B6 — fonds disponibles pour dépôt bancaire : filtrés par l'API et paginés
  // (le filtrage d'une seule page dans le navigateur cachait les fonds plus anciens)
  const depositQuery = useInfiniteQuery({
    queryKey: ['contributions-en-caisse'],
    queryFn: async ({ pageParam }) => (await api.get('/contributions', {
      params: { statut: 'CONFIRME', localisation: DEPOSITABLE.join(','), limit: 100, page: pageParam },
    })).data as { data: Contribution[]; pagination: { page: number; totalPages: number; total: number; totalAmount: number } },
    initialPageParam: 1,
    getNextPageParam: last => (last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
    enabled: data?.myRole === 'TRESORIER',
    refetchInterval: 30000,
  })
  const caisseData = useMemo(() => depositQuery.data?.pages.flatMap(p => p.data) ?? [], [depositQuery.data])
  const caisseTotals = depositQuery.data?.pages[0]?.pagination
  const caisseLoading = depositQuery.isLoading

  const myRole = (data?.myRole ?? 'MEMBRE') as UserRole
  const isCollector = myRole === 'COLLECTEUR'
  const isTreasurer = myRole === 'TRESORIER'
  // L'ADMIN (et le DEVELOPER) voit les preuves de dépôt : références de bordereau
  const canSeeDeposits = ['TRESORIER', 'ADMIN', 'DEVELOPER'].includes(myRole)
  // Circuit officiel : on ne remet que les fonds que l'on détient (l'ADMIN peut
  // initier pour un détenteur) ; le destinataire confirme dans « Fonds à réceptionner ».
  const canTransferAny = myRole === 'ADMIN' || myRole === 'DEVELOPER'
  const { data: eligibleRecipients = [] } = useQuery<Array<{ id: string; fullName: string; role: string }>>({
    queryKey: ['funds-eligible-receivers'],
    queryFn: async () => (await api.get('/funds/eligible-receivers')).data.data,
    enabled: !!data,
  })

  const transferMutation = useMutation({
    mutationFn: () => api.post('/funds/transfer', {
      receiverId: recipientId,
      contributionIds: selected,
      transferType,
    }),
    onSuccess: async () => {
      setSelected([])
      setRecipientId('')
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['transfers'] })
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

  const contributions = useMemo(() => data?.contributions ?? [], [data?.contributions])
  const isTransferable = (c: Contribution) =>
    c.localisationFonds === 'CHEZ_COLLECTEUR' && (canTransferAny || c.collecteurId === data?.myUserId)
  const selectedTotal = useMemo(
    () => contributions.filter(c => selected.includes(c.id)).reduce((sum, c) => sum + c.montant, 0),
    [contributions, selected]
  )

  const isPending = transferMutation.isPending
  const [expanded, setExpanded] = useState<string[]>([])
  const groups = useMemo(() => (data?.summary ?? []).map(summary => ({
    summary,
    items: contributions.filter(c => (c.collecteurId ?? 'sans-collecteur') === summary.collecteurId),
  })), [data?.summary, contributions])

  function toggle(id: string) {
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  function submitTransfer() {
    setError('')
    transferMutation.mutate()
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="À remettre" value={formatAmount(data?.totals.totalARemettre ?? 0)} />
        <Kpi label="Contributions" value={String(data?.totals.totalContributions ?? 0)} />
        <Kpi label="En retard" value={String(data?.totals.totalEnRetard ?? 0)} tone={(data?.totals.totalEnRetard ?? 0) > 0 ? 'warning' : 'default'} />
        <Kpi label="Délai max" value={`${data?.totals.maxRetentionDays ?? 7} jour(s)`} />
      </div>

      <MoneyFlow
        flow={data?.flow}
        selectedTotal={selectedTotal}
      />

      {/* Fonds à remettre, regroupés par collecteur (UX-09) */}
      <section aria-labelledby="fonds-a-remettre" className="bg-white rounded-[18px] border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 id="fonds-a-remettre" className="font-display font-semibold text-[#0F4A0F]">Fonds à remettre</h3>
          <p className="text-xs text-slate-500">
            Le destinataire confirme la réception dans « Fonds à réceptionner » ; un bordereau est alors généré.
            {!canTransferAny && ' Seuls les fonds que vous détenez peuvent être sélectionnés.'}
          </p>
        </div>
        {error && <div className="m-4 px-3 py-2 rounded-[10px] bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-[12px] bg-gray-100" />)}</div>
        ) : groups.length === 0 ? (
          <EmptyState icon={Wallet} title="Aucun fonds à reverser" description="Les contributions confirmées chez les collecteurs apparaîtront ici." />
        ) : (
          groups.map(group => (
            <CollectorGroup
              key={group.summary.collecteurId}
              summary={group.summary}
              items={group.items}
              open={groups.length === 1 || expanded.includes(group.summary.collecteurId)}
              onToggleOpen={() => setExpanded(cur => cur.includes(group.summary.collecteurId) ? cur.filter(k => k !== group.summary.collecteurId) : [...cur, group.summary.collecteurId])}
              selected={selected}
              isSelectable={isTransferable}
              onToggle={toggle}
              onToggleGroup={ids => setSelected(cur => ids.every(id => cur.includes(id)) ? cur.filter(id => !ids.includes(id)) : Array.from(new Set([...cur, ...ids])))}
            />
          ))
        )}
      </section>

      {/* Barre de remise : visible dès qu'une contribution est sélectionnée */}
      {selected.length > 0 && (
        <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:bottom-4 z-20 mt-3 rounded-[18px] bg-[#0F4A0F] p-3 text-white shadow-[0_12px_32px_rgba(15,74,15,0.35)]">
          <div className="mb-2 flex items-center justify-between gap-2 text-sm">
            <span><b>{selected.length}</b> sélectionnée(s) · <b className="font-mono">{formatAmount(selectedTotal)}</b></span>
            <button type="button" onClick={() => setSelected([])} className="min-h-9 px-2 text-xs text-white/70 underline">Tout désélectionner</button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
            <select value={recipientId} onChange={e => setRecipientId(e.target.value)} aria-label="Destinataire"
              className="min-h-11 rounded-[10px] border-0 bg-white px-3 text-sm text-gray-800 focus:outline-none">
              <option value="">Remettre à…</option>
              {eligibleRecipients.map(u => (
                <option key={u.id} value={u.id}>{u.fullName} ({ROLE_LABELS[u.role as UserRole] ?? u.role})</option>
              ))}
            </select>
            <select value={transferType} onChange={e => setTransferType(e.target.value as TransferType)} aria-label="Mode de remise"
              className="min-h-11 rounded-[10px] border-0 bg-white px-3 text-sm text-gray-800 focus:outline-none">
              {Object.entries(TRANSFER_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <Button variant="yellow" disabled={!recipientId} loading={isPending} onClick={submitTransfer}>
              <UserPlus size={14} />
              Remettre les fonds
            </Button>
          </div>
        </div>
      )}

      {/* B6 : Dépôt bancaire — section trésorier */}
      {isTreasurer && (
        <section aria-labelledby="depot-bancaire" className="mt-5 bg-white rounded-[18px] border border-blue-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-blue-50">
            <h3 id="depot-bancaire" className="font-display font-semibold text-[#1E3A5F] flex items-center gap-2"><Banknote size={16} /> Dépôt bancaire</h3>
            <p className="text-xs text-slate-500">
              {caisseTotals ? `${caisseTotals.total} contribution(s) à déposer · ${formatAmount(caisseTotals.totalAmount)}` : 'Fonds en caisse, remis au trésorier ou sur le portefeuille électronique'}
            </p>
          </div>
          {bankError && <div className="m-4 px-3 py-2 rounded-[10px] bg-red-50 border border-red-100 text-sm text-red-600">{bankError}</div>}
          {caisseLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-[12px] bg-gray-100" />)}</div>
          ) : caisseData.length === 0 ? (
            <EmptyState icon={Banknote} title="Aucun fonds disponible" description="Les fonds en caisse ou remis au trésorier apparaîtront ici pour dépôt." />
          ) : (
            <>
              {/* Regroupé par emplacement, replié : on dépose souvent tout un emplacement d'un coup */}
              {DEPOSITABLE.map(loc => {
                const items = caisseData.filter(c => c.localisationFonds === loc)
                if (items.length === 0) return null
                const ids = items.map(c => c.id)
                const allIn = ids.every(id => bankSelected.includes(id))
                const isOpen = bankOpen.includes(loc)
                return (
                  <div key={loc} className="border-b border-gray-100 last:border-b-0">
                    <div className="flex min-h-[56px] items-center gap-3 px-4">
                      <input type="checkbox" className="h-5 w-5 shrink-0 accent-[#1E3A5F]" aria-label={`Tout sélectionner : ${LOCATION_LABELS[loc]}`}
                        checked={allIn}
                        onChange={() => setBankSelected(curr => allIn ? curr.filter(id => !ids.includes(id)) : Array.from(new Set([...curr, ...ids])))} />
                      <button type="button" aria-expanded={isOpen}
                        onClick={() => setBankOpen(cur => cur.includes(loc) ? cur.filter(l => l !== loc) : [...cur, loc])}
                        className="flex min-h-[56px] min-w-0 flex-1 items-center gap-2 text-left">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-gray-800">{LOCATION_LABELS[loc]}</span>
                          <span className="block text-xs text-slate-500">{items.length} contribution(s){ids.some(id => bankSelected.includes(id)) && !allIn ? ` · ${ids.filter(id => bankSelected.includes(id)).length} sélectionnée(s)` : ''}</span>
                        </span>
                        <span className="font-mono text-sm font-bold text-[#1E3A5F]">{formatAmount(items.reduce((sum, c) => sum + c.montant, 0))}</span>
                        <ChevronDown size={16} className={cn('shrink-0 text-gray-400 transition-transform', isOpen && 'rotate-180')} aria-hidden />
                      </button>
                    </div>
                    {isOpen && (
                      <ul className="bg-gray-50/40">
                        {items.map(c => (
                          <SelectableRow key={c.id} contribution={c}
                            subtitle={`${c.rubrique?.code ?? ''} · ${MODE_PAIEMENT_LABELS[c.modePaiement]} · ${formatDate(c.createdAt)}`}
                            selected={bankSelected.includes(c.id)}
                            onToggle={() => setBankSelected(curr => curr.includes(c.id) ? curr.filter(id => id !== c.id) : [...curr, c.id])} />
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
              {depositQuery.hasNextPage && (
                <div className="p-3 text-center">
                  <Button size="sm" variant="outline" loading={depositQuery.isFetchingNextPage} onClick={() => depositQuery.fetchNextPage()}>
                    Afficher plus ({caisseData.length} sur {caisseTotals?.total ?? 0})
                  </Button>
                </div>
              )}
            </>
          )}
          <div className="grid grid-cols-1 gap-2 border-t border-gray-100 p-3 sm:grid-cols-[1fr_auto]">
            <input
              value={referenceBordereau}
              onChange={e => setReferenceBordereau(e.target.value)}
              placeholder="Réf. bordereau (ex : BRD-2026-001)"
              aria-label="Référence du bordereau"
              className="min-h-11 w-full rounded-[10px] border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <Button
              variant="primary"
              disabled={bankSelected.length === 0 || !referenceBordereau.trim()}
              loading={bankDepositMutation.isPending}
              onClick={() => { setBankError(''); bankDepositMutation.mutate() }}
            >
              <Banknote size={14} />
              Déposer {bankSelected.length > 0 ? `${formatAmount(caisseData.filter(c => bankSelected.includes(c.id)).reduce((sum, c) => sum + c.montant, 0))} (${bankSelected.length})` : 'en banque'}
            </Button>
          </div>
        </section>
      )}

      {/* B6 : Historique des dépôts — les références de bordereau sont les PREUVES
          consultables par l'ADMIN (et le trésorier) */}
      {canSeeDeposits && <BankDepositHistory />}

      <TraceSection />
    </div>
  )
}

// ── B6 : Historique des dépôts bancaires (preuves) ─────────────────────
interface BankDepositEntry {
  id: string
  referenceBordereau: string
  dateBordereau: string | null
  note: string | null
  totalAmount: number
  depositedByName: string
  createdAt: string
  contributions: Array<{
    id: string
    montant: number
    modePaiement: string
    membre?: { user: { fullName: string } }
    rubrique?: { code: string; title: string }
  }>
}

function BankDepositHistory() {
  const [detail, setDetail] = useState<BankDepositEntry | null>(null)
  const { data: deposits, isLoading } = useQuery<BankDepositEntry[]>({
    queryKey: ['bank-deposits'],
    queryFn: async () => (await api.get('/funds/bank-deposits')).data.data,
    refetchInterval: 30000,
  })

  return (
    <div className="mt-5 bg-white rounded-[18px] border border-gray-100 overflow-hidden">
      <div className="px-5 py-4"
        style={{ background: 'linear-gradient(135deg, #0F4A0F, #1A6B1A)' }}>
        <h3 className="font-display font-semibold text-white text-sm flex items-center gap-2">
          <Landmark size={16} /> Historique des dépôts bancaires
        </h3>
        <p className="text-white/60 text-xs">Chaque référence de bordereau/relevé est la preuve du versement en banque</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-mobile-cards">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              {['Date', 'Réf. bordereau / relevé', 'Montant', 'Déposé par', 'Contributions', ''].map(col => (
                <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <SkeletonTableRow key={i} cols={6} />)
            ) : (deposits?.length ?? 0) === 0 ? (
              <tr><td colSpan={6}><EmptyState icon={Landmark} title="Aucun dépôt enregistré" description="Les dépôts bancaires du trésorier apparaîtront ici avec leur référence de bordereau." /></td></tr>
            ) : (
              (deposits ?? []).map(d => (
                <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3 text-xs text-gray-500" data-label="Date">
                    {formatDateTime(d.createdAt)}
                    {d.dateBordereau && <p className="text-[10px] text-gray-400">Bordereau : {formatDate(d.dateBordereau)}</p>}
                  </td>
                  <td className="px-4 py-3" data-label="Réf. bordereau">
                    <span className="inline-flex items-center gap-1.5 font-mono font-bold text-[#0F4A0F] bg-[#E8F5E8] border border-[#1A6B1A]/20 px-2.5 py-1 rounded-[8px]">
                      <ShieldCheck size={12} className="text-[#1A6B1A]" />
                      {d.referenceBordereau}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono font-bold text-[#0F4A0F]" data-label="Montant">{formatAmount(d.totalAmount)}</td>
                  <td className="px-4 py-3 text-xs text-gray-600" data-label="Déposé par">{d.depositedByName}</td>
                  <td className="px-4 py-3 text-xs text-gray-500" data-label="Contributions">{d.contributions.length} contribution(s)</td>
                  <td className="px-4 py-3 text-right" data-label="Action">
                    <Button size="sm" variant="ghost" onClick={() => setDetail(d)}>Détail</Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Détail d'un dépôt : contributions couvertes par la preuve */}
      <Modal open={!!detail} onClose={() => setDetail(null)} size="lg"
        title={`Dépôt ${detail?.referenceBordereau ?? ''}`}
        description={`${formatAmount(detail?.totalAmount ?? 0)} FCFA · déposé par ${detail?.depositedByName ?? ''} · ${detail ? formatDateTime(detail.createdAt) : ''}`}>
        {detail?.note && <p className="mb-3 text-xs text-gray-500 italic">Note : « {detail.note} »</p>}
        <div className="max-h-[45vh] overflow-y-auto">
          <table className="w-full text-sm table-mobile-cards">
            <thead>
              <tr className="border-b border-gray-100">
                {['Membre', 'Rubrique', 'Mode', 'Montant'].map(col => (
                  <th key={col} className="px-3 py-2 text-left text-xs font-semibold text-gray-500">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail?.contributions.map(c => (
                <tr key={c.id} className="border-b border-gray-50">
                  <td className="px-3 py-2 text-gray-800">
                    <div className="flex items-center gap-2">
                      <Avatar name={contributorName(c)} size="xs" />
                      <span>{contributorName(c)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-gray-600" data-label="Rubrique">{c.rubrique?.code}</td>
                  <td className="px-3 py-2 text-xs text-gray-500" data-label="Mode">{MODE_PAIEMENT_LABELS[c.modePaiement] ?? c.modePaiement}</td>
                  <td className="px-3 py-2 font-mono font-semibold text-[#0F4A0F]" data-label="Montant">{formatAmount(c.montant)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  )
}

function MoneyFlow({ flow, selectedTotal }: {
  flow?: CollecteursResponse['flow']
  selectedTotal: number
}) {
  const chezCollecteur = flow?.chezCollecteur ?? 0
  const enTransit = flow?.enTransit ?? 0
  const electronique = flow?.electroniqueTotal ?? 0
  // Électronique confirmé et pas encore versé en banque (compte marchand Yelii/CinetPay)
  const portefeuille = flow?.portefeuilleElectronique ?? 0
  const chezTresorier = (flow?.remisTresorier ?? 0) + (flow?.chezResponsable ?? 0) + (flow?.enCaisse ?? 0)
  const enBanque = flow?.enBanque ?? 0

  return (
    <div className="mb-5 rounded-[18px] border border-gray-100 bg-white p-4 overflow-hidden">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 mb-5">
        <div>
          <h3 className="font-display font-semibold text-[#0F4A0F] text-lg">Trajet de l&apos;argent</h3>
          <p className="text-xs text-gray-500">
            Espèces : contributeur → collecteur → trésorier. Mobile Money / Carte : crédité sur le portefeuille électronique (compte marchand), aucune personne ne le détient.
          </p>
        </div>
        {selectedTotal > 0 && (
          <div className="rounded-[10px] bg-[#F5C400]/20 px-3 py-2 text-xs font-semibold text-[#0F4A0F]">
            Sélection à remettre : {formatAmount(selectedTotal)}
          </div>
        )}
      </div>

      {/* Voie 1 — Espèces, via le collecteur */}
      <FlowLane label="Espèces — remises en main propre" icon={HandCoins} amount={chezCollecteur + enTransit}>
        <FlowStep icon={HandCoins} label="Chez collecteurs" value={chezCollecteur} active={chezCollecteur > 0} />
        <FlowTrack active={chezCollecteur > 0} />
        <FlowStep icon={RefreshCw} label="En transit" value={enTransit} active={enTransit > 0} muted />
      </FlowLane>

      {/* Voie 2 — Mobile Money / Carte, direct chez le trésorier */}
      <FlowLane label="Mobile Money & Carte — direct, sans collecteur" icon={Smartphone} amount={electronique}>
        <FlowStep icon={Smartphone} label="Yelii / CinetPay" value={electronique} active={electronique > 0} />
        <FlowTrack active={electronique > 0} instant />
        <FlowStep icon={Wallet} label="Portefeuille électronique" value={portefeuille} active={portefeuille > 0} ghost />
      </FlowLane>

      {/* Convergence — trésorerie puis banque */}
      <div className="mt-1 pt-4 border-t border-dashed border-gray-200">
        <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Trésorerie</p>
        <div className="grid grid-cols-2 lg:grid-cols-[1fr_auto_1fr] gap-2 lg:gap-3 items-stretch">
          <FlowStep icon={ShieldCheck} label="Trésorier / Caisse / Responsable" value={chezTresorier} active={chezTresorier > 0} />
          <FlowTrack active={enBanque > 0} vertical />
          <FlowStep icon={Building2} label="Banque" value={enBanque} active={enBanque > 0} />
        </div>
      </div>

      <div className="mt-4 h-2 rounded-full bg-gray-100 overflow-hidden flex">
        <FlowBar color="bg-amber-400" value={chezCollecteur + enTransit} total={flow?.totalConfirme ?? 0} />
        <FlowBar color="bg-purple-400" value={portefeuille} total={flow?.totalConfirme ?? 0} />
        <FlowBar color="bg-[#1A6B1A]" value={chezTresorier} total={flow?.totalConfirme ?? 0} />
        <FlowBar color="bg-[#0F4A0F]" value={enBanque} total={flow?.totalConfirme ?? 0} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Espèces en circulation</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400" /> Portefeuille électronique</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#1A6B1A]" /> Trésorerie</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#0F4A0F]" /> Banque</span>
        <span className="ml-auto font-semibold text-gray-500">Total confirmé tracé : {formatAmount(flow?.totalConfirme ?? 0)}</span>
      </div>
    </div>
  )
}

function FlowLane({ label, icon: Icon, amount, children }: {
  label: string
  icon: React.ElementType
  amount: number
  children: React.ReactNode
}) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
        <Icon size={12} /> {label}
        {amount > 0 && <span className="normal-case font-semibold text-[#1A6B1A]">· {formatAmount(amount)}</span>}
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-[1fr_auto_1fr] gap-2 lg:gap-3 items-stretch">
        {children}
      </div>
    </div>
  )
}

function FlowStep({ icon: Icon, label, value, active, muted, ghost }: {
  icon: React.ElementType
  label: string
  value: number
  active?: boolean
  muted?: boolean
  ghost?: boolean
}) {
  return (
    <div className={cn(
      'relative rounded-[14px] border p-3 lg:p-4 transition-all duration-300',
      active ? 'border-[#1A6B1A]/40 bg-[#F2FFF4] shadow-cem' : 'border-gray-100 bg-gray-50/70',
      muted && !active && 'bg-gray-50',
      ghost && 'border-dashed'
    )}>
      {active && <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-[#F5C400] animate-ping" />}
      <div className="flex flex-col items-start gap-2 lg:flex-row lg:items-center lg:gap-3">
        <div className={cn(
          'flex h-9 w-9 lg:h-10 lg:w-10 shrink-0 items-center justify-center rounded-[10px]',
          active ? 'bg-[#1A6B1A] text-white' : 'bg-white text-[#1A6B1A]'
        )}>
          <Icon size={19} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500">{label}</p>
          <p className="font-display text-lg lg:text-xl font-bold text-[#0F4A0F] leading-tight">{formatAmount(value)}</p>
        </div>
      </div>
    </div>
  )
}

/** Connecteur animé entre deux étapes : des points d'or défilent en continu tant que
 * l'étape amont contient des fonds — représentation "vivante" du mouvement réel. */
function FlowTrack({ active, instant, vertical }: { active?: boolean; instant?: boolean; vertical?: boolean }) {
  return (
    <div className={cn('hidden lg:flex items-center justify-center', vertical ? 'flex-col' : '')} style={{ width: vertical ? 'auto' : 56 }}>
      <div className={cn('flow-track w-12', active && 'flow-track-active')} title={instant ? 'Crédit instantané' : 'Transfert physique'}>
        {active && <span className="flow-dot" />}
        {active && <span className="flow-dot" />}
        {active && <span className="flow-dot" />}
      </div>
      <ArrowRight size={14} className={cn('mt-0.5', active ? 'text-[#F5C400]' : 'text-gray-300')} />
    </div>
  )
}

function FlowBar({ color, value, total }: { color: string; value: number; total: number }) {
  if (total <= 0 || value <= 0) return null
  return <div className={color} style={{ width: `${Math.max(4, (value / total) * 100)}%` }} />
}

function CollectorGroup({ summary, items, open, onToggleOpen, selected, isSelectable, onToggle, onToggleGroup }: {
  summary: CollecteurSummary
  items: Contribution[]
  open: boolean
  onToggleOpen: () => void
  selected: string[]
  isSelectable: (c: Contribution) => boolean
  onToggle: (id: string) => void
  onToggleGroup: (ids: string[]) => void
}) {
  const selectableIds = items.filter(isSelectable).map(c => c.id)
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.includes(id))
  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button type="button" onClick={onToggleOpen} aria-expanded={open}
        className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1A6B1A]">
        <Avatar name={summary.collecteurName} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-gray-800">{summary.collecteurName}</span>
          <span className="block truncate text-xs text-slate-500">
            {summary.nbContributions} contribution(s)
            {summary.totalEnTransit > 0 && ` · ${formatAmount(summary.totalEnTransit)} en transit`}
            {summary.oldestContributionAt && ` · depuis le ${formatDate(summary.oldestContributionAt)}`}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="font-mono text-sm font-bold text-[#1A6B1A]">{formatAmount(summary.totalARemettre)}</span>
          {summary.nbEnRetard > 0 && <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-600"><AlertTriangle size={11} /> {summary.nbEnRetard} en retard</span>}
        </span>
        <ChevronDown size={16} className={cn('shrink-0 text-gray-400 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="bg-gray-50/40">
          {selectableIds.length > 0 && (
            <label className="flex min-h-11 items-center gap-3 px-4 text-xs font-semibold text-slate-600">
              <input type="checkbox" className="h-5 w-5 accent-[#1A6B1A]" checked={allSelected} onChange={() => onToggleGroup(selectableIds)} />
              Tout sélectionner chez {summary.collecteurName}
            </label>
          )}
          <ul>
            {items.map(c => (
              <SelectableRow key={c.id} contribution={c}
                subtitle={`${c.rubrique?.code ?? ''} · ${MODE_PAIEMENT_LABELS[c.modePaiement]} · ${LOCATION_LABELS[c.localisationFonds ?? ''] ?? '—'} · ${formatDate(c.createdAt)}`}
                selected={selected.includes(c.id)}
                disabled={!isSelectable(c)}
                onToggle={() => onToggle(c.id)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Ligne compacte cochable : toute la ligne est la cible (≥ 56 px). */
function SelectableRow({ contribution: c, subtitle, selected, disabled, onToggle }: {
  contribution: Contribution
  subtitle: string
  selected: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <li className="border-t border-gray-50">
      <label className={cn('flex min-h-14 items-center gap-3 px-4 py-2', disabled ? 'cursor-default' : 'cursor-pointer hover:bg-white')}
        title={disabled ? 'Fonds détenus par une autre personne ou déjà en transit' : undefined}>
        {disabled
          ? <span className="h-5 w-5 shrink-0" aria-hidden />
          : <input type="checkbox" className="h-5 w-5 shrink-0 accent-[#1A6B1A]" checked={selected} onChange={onToggle} />}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-gray-800">{contributorName(c)}</span>
            <ContributorBadge kind={contributorKind(c)} />
          </span>
          <span className="block truncate text-xs text-slate-500">{subtitle}</span>
        </span>
        <span className="shrink-0 font-mono text-sm font-bold text-[#1A6B1A]">{formatAmount(c.montant)}</span>
      </label>
    </li>
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
