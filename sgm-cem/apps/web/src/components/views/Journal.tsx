'use client'
import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, History, ScrollText, X } from 'lucide-react'
import api from '@/lib/api'
import { cn, formatDateTime, ROLE_LABELS, ROLE_LEVELS } from '@/lib/utils'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Avatar } from '@/components/ui/Avatar'
import { useAuthStore } from '@/store/authStore'

// ─── Types ───────────────────────────────────────────────────────────
interface AuditEntry {
  id: string
  userId: string
  userName: string
  action: string
  entityType: string
  entityId: string | null
  details: Record<string, unknown> | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  user?: { role: string }
}

interface AuditResponse {
  logs: AuditEntry[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface AuditUser { id: string; fullName: string; role: string }

// ─── Libellés ────────────────────────────────────────────────────────
const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Connexion',
  LOGOUT: 'Déconnexion',
  CREATE: 'Création',
  UPDATE: 'Modification',
  DELETE: 'Suppression',
  CONFIRM: 'Confirmation',
  REJECT: 'Rejet',
  APPROVE: 'Approbation',
  TRANSFER: 'Transfert',
  CLAIM: 'Réclamation',
  TRANSFER_CONFIRMED: 'Transfert confirmé',
  TRANSFER_REFUSED: 'Transfert refusé',
  TRANSFER_CANCELLED: 'Transfert annulé',
  DEVELOPER_PANEL_CONFIG_CHANGED: 'Config technique',
  IMPERSONATE: 'Impersonation',
}

// Couleurs de badge par famille d'action
const ACTION_STYLES: Record<string, string> = {
  LOGIN: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  LOGOUT: 'bg-gray-50 text-gray-600 border-gray-200',
  CREATE: 'bg-blue-50 text-blue-700 border-blue-200',
  UPDATE: 'bg-amber-50 text-amber-700 border-amber-200',
  DELETE: 'bg-red-50 text-red-700 border-red-200',
  CONFIRM: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECT: 'bg-red-50 text-red-700 border-red-200',
  APPROVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  TRANSFER: 'bg-purple-50 text-purple-700 border-purple-200',
  CLAIM: 'bg-amber-50 text-amber-700 border-amber-200',
  TRANSFER_CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  TRANSFER_REFUSED: 'bg-red-50 text-red-700 border-red-200',
  TRANSFER_CANCELLED: 'bg-gray-50 text-gray-600 border-gray-200',
  DEVELOPER_PANEL_CONFIG_CHANGED: 'bg-slate-100 text-slate-700 border-slate-300',
  IMPERSONATE: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
}

const ENTITY_LABELS: Record<string, string> = {
  Session: 'Session',
  User: 'Utilisateur',
  Membre: 'Membre',
  Contribution: 'Contribution',
  FundsTransfer: 'Transfert de fonds',
  BankDeposit: 'Dépôt bancaire',
  Rubrique: 'Rubrique',
  Prestation: 'Prestation',
  Notification: 'Notification',
  SystemConfig: 'Configuration',
  Document: 'Document',
}

const DETAIL_LABELS: Record<string, string> = {
  method: 'Méthode',
  success: 'Résultat',
  reason: 'Motif',
  role: 'Rôle',
  montant: 'Montant',
  statut: 'Statut',
  action: 'Action',
  source: 'Source',
  modePaiement: 'Mode',
  targetEmail: 'Compte cible',
  targetRole: 'Rôle cible',
  key: 'Clé',
  motif: 'Motif',
}

const DETAIL_VALUES: Record<string, string> = {
  email: 'Email + mot de passe',
  otp: 'Téléphone (OTP)',
  google: 'Google',
  wrong_password: 'Mot de passe incorrect',
  password_changed: 'Mot de passe modifié',
  payment_initiate: 'Paiement (stepper)',
  start: 'Début',
  stop: 'Fin',
}

function formatDetailValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Réussie' : 'Échouée'
  if (typeof value === 'number') return value.toLocaleString('fr-FR')
  const s = String(value)
  return DETAIL_VALUES[s] ?? s
}

function DetailChips({ details }: { details: Record<string, unknown> | null }) {
  if (!details || typeof details !== 'object') return <span className="text-gray-300">—</span>
  const entries = Object.entries(details).filter(([, v]) => v != null && typeof v !== 'object')
  if (!entries.length) return <span className="text-gray-300">—</span>
  return (
    <div className="flex flex-wrap gap-1 max-w-[280px]">
      {entries.slice(0, 4).map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1 text-[10px] bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5 text-gray-600">
          <span className="font-semibold text-gray-400">{DETAIL_LABELS[k] ?? k}</span>
          {formatDetailValue(v)}
        </span>
      ))}
    </div>
  )
}

const filterInputCls = 'rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30'

// ─── Vue ─────────────────────────────────────────────────────────────
export function Journal() {
  const { user } = useAuthStore()
  const level = ROLE_LEVELS[user?.role ?? ''] ?? 1
  const canSeeOthers = level >= 3

  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [userId, setUserId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const hasFilters = Boolean(action || entityType || userId || from || to)

  const { data, isLoading } = useQuery<AuditResponse>({
    queryKey: ['audit-logs', page, action, entityType, userId, from, to],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '25' })
      if (action) params.set('action', action)
      if (entityType) params.set('entityType', entityType)
      if (userId) params.set('userId', userId)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      return (await api.get(`/audit?${params}`)).data.data
    },
    placeholderData: keepPreviousData,
    refetchInterval: 30000,
  })

  const { data: actors } = useQuery<AuditUser[]>({
    queryKey: ['audit-users'],
    queryFn: async () => (await api.get('/audit/users')).data.data,
    enabled: canSeeOthers,
    staleTime: 5 * 60 * 1000,
  })

  const logs = data?.logs ?? []

  const title = level >= 5 ? "Journal d'audit" : canSeeOthers ? "Journal d'activité" : 'Mon activité'
  const subtitle = level >= 5
    ? 'Toutes les opérations du système — qui a fait quoi, quand, depuis où'
    : canSeeOthers
      ? 'Opérations financières et votre propre activité'
      : 'Vos connexions et vos opérations'

  function resetFilters() {
    setAction(''); setEntityType(''); setUserId(''); setFrom(''); setTo(''); setPage(1)
  }

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      {/* Header */}
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[#1A6B1A]" />
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#1A6B1A]">Traçabilité</p>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">{title}</h2>
            <p className="text-gray-500 text-sm mt-0.5">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2 rounded-[14px] bg-[#1A6B1A]/5 border border-[#1A6B1A]/15 px-4 py-3">
            <History size={16} className="text-[#1A6B1A]" />
            <div>
              <p className="text-xs text-[#0F4A0F] font-medium">Entrées journalisées</p>
              <p className="font-mono font-bold text-[#0F4A0F]">{(data?.total ?? 0).toLocaleString('fr-FR')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filtres */}
      <div className="bg-white rounded-[18px] border border-gray-100 p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Action</label>
          <select value={action} onChange={e => { setAction(e.target.value); setPage(1) }} className={filterInputCls}>
            <option value="">Toutes</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Élément</label>
          <select value={entityType} onChange={e => { setEntityType(e.target.value); setPage(1) }} className={filterInputCls}>
            <option value="">Tous</option>
            {Object.entries(ENTITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        {canSeeOthers && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Utilisateur</label>
            <select value={userId} onChange={e => { setUserId(e.target.value); setPage(1) }} className={cn(filterInputCls, 'max-w-[180px]')}>
              <option value="">Tous</option>
              {(actors ?? []).map(a => (
                <option key={a.id} value={a.id}>{a.fullName} ({ROLE_LABELS[a.role] ?? a.role})</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Du</label>
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1) }} className={filterInputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Au</label>
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1) }} className={filterInputCls} />
        </div>
        {hasFilters && (
          <button
            onClick={resetFilters}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-red-600 transition-colors px-3 py-2"
          >
            <X size={13} /> Réinitialiser
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden shadow-[0_2px_12px_rgba(15,74,15,0.06)]">
        <div className="px-5 py-4 flex items-center justify-between"
          style={{ background: 'linear-gradient(135deg, #0F4A0F, #1A6B1A)' }}>
          <h3 className="font-display font-semibold text-white text-sm">Qui a fait quoi ?</h3>
          <span className="text-white/60 text-xs bg-white/10 px-2.5 py-1 rounded-full">
            Page {data?.page ?? 1} / {data?.totalPages ?? 1}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm table-mobile-cards">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                {['Date & heure', 'Utilisateur', 'Action', 'Élément', 'Détails', 'Adresse IP'].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => <SkeletonTableRow key={i} cols={6} />)
              ) : logs.length === 0 ? (
                <tr><td colSpan={6}>
                  <EmptyState
                    icon={ScrollText}
                    title="Aucune activité"
                    description={hasFilters ? 'Aucune entrée ne correspond aux filtres sélectionnés.' : 'Aucune opération journalisée pour le moment.'}
                  />
                </td></tr>
              ) : (
                logs.map(log => (
                  <tr key={log.id} className="border-b border-gray-50 hover:bg-[#1A6B1A]/4 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-gray-600">{formatDateTime(log.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar name={log.userName} size="xs" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-gray-800 text-xs">{log.userName}</p>
                          {log.user?.role && (
                            <p className="truncate text-[10px] text-gray-400">{ROLE_LABELS[log.user.role] ?? log.user.role}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3" data-label="Action">
                      <span className={cn(
                        'inline-block text-[11px] font-semibold border rounded-full px-2.5 py-1 whitespace-nowrap',
                        ACTION_STYLES[log.action] ?? 'bg-gray-50 text-gray-600 border-gray-200'
                      )}>
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap" data-label="Élément">{ENTITY_LABELS[log.entityType] ?? log.entityType}</td>
                    <td className="px-4 py-3" data-label="Détails"><DetailChips details={log.details} /></td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400 whitespace-nowrap" data-label="Adresse IP">{log.ipAddress ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {(data?.totalPages ?? 1) > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/40">
            <p className="text-xs text-gray-500">
              {data?.total.toLocaleString('fr-FR')} entrée(s) — page {data?.page} sur {data?.totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 text-xs font-medium text-[#0F4A0F] disabled:text-gray-300 hover:bg-[#1A6B1A]/8 rounded-[8px] px-2.5 py-1.5 transition-colors"
              >
                <ChevronLeft size={14} /> Précédent
              </button>
              <button
                onClick={() => setPage(p => Math.min(data?.totalPages ?? p, p + 1))}
                disabled={page >= (data?.totalPages ?? 1)}
                className="flex items-center gap-1 text-xs font-medium text-[#0F4A0F] disabled:text-gray-300 hover:bg-[#1A6B1A]/8 rounded-[8px] px-2.5 py-1.5 transition-colors"
              >
                Suivant <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
