'use client'
// ──────────────────────────────────────────────────────────────────────
// PANNEAU DÉVELOPPEUR — DEVELOPER_PANEL_SGM_CEM.md §4-§5
// Visible UNIQUEMENT par le rôle DEVELOPER (la route API est protégée par
// requireDeveloper — même ADMIN reçoit 403).
// La base de données est la source de vérité : chaque modification prend
// effet immédiatement, sans redémarrage du serveur.
// ──────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Webhook, KeyRound, Percent, Network, SlidersHorizontal, Bell, ToggleLeft,
  Eye, EyeOff, History, Save, RefreshCw, PlugZap, Terminal, ShieldAlert, X, Info,
} from 'lucide-react'
import api from '@/lib/api'
import { cn, formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { useAppStore } from '@/store/appStore'

// ── Types ──────────────────────────────────────────────────────────────
interface ConfigItem {
  key: string
  value: string
  category: 'WEBHOOKS' | 'INTEGRATION_KEYS' | 'FINANCIAL' | 'INFRASTRUCTURE' | 'SYSTEM_BEHAVIOR' | 'NOTIFICATIONS' | 'FEATURE_FLAGS'
  label: string
  description: string | null
  isSecret: boolean
  isEditable: boolean
  updatedAt: string
}

interface HistoryEntry {
  id: string
  configKey: string
  oldValue: string | null
  newValue: string
  changedByName: string
  reason: string | null
  createdAt: string
}

const MASK = '••••••••'

// ── Les 7 sections (A-G du doc) ────────────────────────────────────────
const SECTIONS = [
  { id: 'WEBHOOKS',         label: 'Webhooks & Callbacks',    icon: Webhook },
  { id: 'INTEGRATION_KEYS', label: "Clés d'intégration",      icon: KeyRound },
  { id: 'FINANCIAL',        label: 'Paramètres financiers',   icon: Percent },
  { id: 'INFRASTRUCTURE',   label: 'Infrastructure & réseau', icon: Network },
  { id: 'SYSTEM_BEHAVIOR',  label: 'Comportement système',    icon: SlidersHorizontal },
  { id: 'NOTIFICATIONS',    label: 'Notifications',           icon: Bell },
  { id: 'FEATURE_FLAGS',    label: 'Feature flags',           icon: ToggleLeft },
] as const

const BOOL_VALUES = ['true', 'false']
const isBoolConfig = (c: ConfigItem) => BOOL_VALUES.includes(c.value) && !c.isSecret

// ── Ligne de configuration générique ──────────────────────────────────
function ConfigRow({ config, onHistory }: { config: ConfigItem; onHistory: (key: string) => void }) {
  const { addToast } = useAppStore()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<string | null>(null) // null = pas en édition
  const [revealed, setRevealed] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const save = useMutation({
    mutationFn: (value: string) =>
      api.put(`/developer/config/${config.key}`, { value, reason: reason || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['developer-config'] })
      addToast({ title: config.label, message: 'Mis à jour — effet immédiat, sans redémarrage.', variant: 'success' })
      setDraft(null); setReason(''); setRevealed(null)
    },
    onError: () => addToast({ title: 'Erreur', message: `Impossible de mettre à jour ${config.key}.`, variant: 'error' }),
  })

  const reveal = useMutation({
    mutationFn: () => api.post(`/developer/config/${config.key}/reveal`, {}),
    onSuccess: (res) => setRevealed(res.data.data.value as string),
    onError: () => addToast({ title: 'Erreur', message: 'Révélation impossible.', variant: 'error' }),
  })

  const testYelii = useMutation({
    mutationFn: () => api.post('/developer/config/test/yelii', {}),
    onSuccess: (res) => {
      const d = res.data.data as { ok: boolean; balance?: number; message?: string }
      if (d.ok) addToast({ title: 'Connexion Yelii OK', message: `Solde wallet : ${d.balance?.toLocaleString('fr-FR') ?? '—'} FCFA`, variant: 'success' })
      else addToast({ title: 'Connexion Yelii échouée', message: d.message ?? 'Erreur inconnue', variant: 'error' })
    },
    onError: () => addToast({ title: 'Test impossible', message: 'Erreur lors du test Yelii.', variant: 'error' }),
  })

  const displayValue = revealed ?? config.value
  const editing = draft !== null

  // Interrupteur direct pour les booléens (flags, interrupteurs)
  if (isBoolConfig(config)) {
    const on = config.value === 'true'
    return (
      <div className="flex items-center justify-between gap-4 p-4 bg-white rounded-[12px] border border-gray-100">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800">{config.label}</p>
          {config.description && <p className="text-xs text-gray-400 mt-0.5">{config.description}</p>}
          <p className="text-[10px] text-gray-300 mt-1 font-mono">{config.key}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => onHistory(config.key)} className="text-gray-300 hover:text-gray-500 transition-colors" title="Historique">
            <History size={15} />
          </button>
          <button
            onClick={() => save.mutate(on ? 'false' : 'true')}
            disabled={save.isPending || !config.isEditable}
            className={cn(
              'relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0',
              on ? 'bg-[#1A6B1A]' : 'bg-gray-200',
              (save.isPending || !config.isEditable) && 'opacity-50'
            )}
            title={on ? 'Désactiver' : 'Activer'}
          >
            <span className={cn(
              'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200',
              on ? 'translate-x-[22px]' : 'translate-x-0.5'
            )} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 bg-white rounded-[12px] border border-gray-100">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800">{config.label}</p>
          {config.description && <p className="text-xs text-gray-400 mt-0.5">{config.description}</p>}
          <p className="text-[10px] text-gray-300 mt-1 font-mono">{config.key} · maj {formatDateTime(config.updatedAt)}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {config.key === 'YELII_COLLECT_API_KEY' && (
            <Button size="sm" variant="outline" onClick={() => testYelii.mutate()} loading={testYelii.isPending} title="Vérifie la clé via /wallet/balance">
              <PlugZap size={12} /> Tester
            </Button>
          )}
          {config.isSecret && (
            revealed !== null ? (
              <button onClick={() => setRevealed(null)} className="text-gray-400 hover:text-gray-600 transition-colors" title="Masquer">
                <EyeOff size={15} />
              </button>
            ) : (
              <button
                onClick={() => { if (window.confirm(`Afficher la valeur de ${config.label} en clair ?\n(Cet accès est enregistré dans l'audit.)`)) reveal.mutate() }}
                className="text-gray-400 hover:text-gray-600 transition-colors" title="Afficher (audité)"
              >
                <Eye size={15} />
              </button>
            )
          )}
          <button onClick={() => onHistory(config.key)} className="text-gray-300 hover:text-gray-500 transition-colors" title="Historique">
            <History size={15} />
          </button>
        </div>
      </div>

      <div className="mt-3">
        {editing ? (
          <div className="space-y-2">
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono border border-[#1A6B1A]/40 rounded-[8px] focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/20 bg-white"
              autoFocus
            />
            <input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Note (optionnel) — ex: rotation de clé, migration serveur…"
              className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-[8px] focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/20"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => save.mutate(draft)} loading={save.isPending}>
                <Save size={12} /> Enregistrer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setDraft(null); setReason('') }}>Annuler</Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => config.isEditable && setDraft(config.isSecret && revealed === null ? '' : displayValue)}
            className={cn(
              'w-full text-left px-3 py-2 text-sm font-mono rounded-[8px] border border-transparent break-all',
              config.isEditable ? 'bg-gray-50 hover:border-[#1A6B1A]/30 hover:bg-gray-100/70 cursor-pointer' : 'bg-gray-50 opacity-60 cursor-not-allowed'
            )}
            title={config.isEditable ? 'Cliquer pour modifier' : 'Valeur non éditable'}
          >
            {config.isSecret && revealed === null ? MASK : displayValue || <span className="text-gray-300 italic">vide</span>}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Carte spéciale §4 : Recalculer l'URL de webhook Yelii ─────────────
function WebhookRecalculateCard({ current, onHistory }: { current?: ConfigItem; onHistory: (key: string) => void }) {
  const { addToast } = useAppStore()
  const queryClient = useQueryClient()
  const [newBaseUrl, setNewBaseUrl] = useState('')
  const [reason, setReason] = useState('')

  const recalc = useMutation({
    mutationFn: () => api.post('/developer/config/webhook/recalculate', { newBaseUrl, reason: reason || undefined }),
    onSuccess: (res) => {
      const d = res.data.data as { webhookUrl: string; manualActionRequired: string }
      queryClient.invalidateQueries({ queryKey: ['developer-config'] })
      addToast({ title: 'Webhook recalculé', message: d.webhookUrl, variant: 'success', duration: 6000 })
      addToast({ title: 'Action manuelle requise', message: d.manualActionRequired, variant: 'warning', duration: 9000 })
      setNewBaseUrl(''); setReason('')
    },
    onError: () => addToast({ title: 'Erreur', message: 'URL invalide ou recalcul impossible.', variant: 'error' }),
  })

  return (
    <div className="p-5 bg-gradient-to-br from-[#0F4A0F]/[0.03] to-[#F5C400]/[0.06] rounded-[14px] border-2 border-[#1A6B1A]/20">
      <div className="flex items-center gap-2 mb-3">
        <Webhook size={18} className="text-[#1A6B1A]" />
        <h3 className="font-display font-semibold text-[#0F4A0F]">Webhook Yelii</h3>
      </div>

      <p className="text-xs text-gray-500 mb-1">URL actuelle :</p>
      <div className="px-3 py-2 bg-white rounded-[8px] border border-gray-200 text-sm font-mono break-all mb-1">
        {current?.value ?? '—'}
      </div>
      {current && (
        <p className="text-[10px] text-gray-400 mb-4">Dernière mise à jour : {formatDateTime(current.updatedAt)}</p>
      )}

      <label className="block text-xs font-semibold text-gray-600 mb-1">Nouvelle base d&apos;URL (domaine ou tunnel actuel)</label>
      <input
        value={newBaseUrl}
        onChange={e => setNewBaseUrl(e.target.value)}
        placeholder="https://nouveau-tunnel.ngrok-free.app"
        className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-[8px] focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/20 mb-2 bg-white"
      />
      <input
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Note (optionnel) — ex: Migration vers Oracle Cloud"
        className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-[8px] focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/20 mb-3 bg-white"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="yellow" onClick={() => recalc.mutate()} loading={recalc.isPending} disabled={!newBaseUrl.trim()}>
          <RefreshCw size={12} /> Recalculer &amp; Enregistrer
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onHistory('YELII_WEBHOOK_URL')}>
          <History size={12} /> Voir l&apos;historique
        </Button>
      </div>
      <p className="text-[10px] text-gray-400 mt-3 flex items-start gap-1">
        <Info size={11} className="flex-shrink-0 mt-0.5" />
        L&apos;URL complète devient <span className="font-mono">&lt;base&gt;/webhooks/yelii</span>. Effet immédiat côté serveur — pensez à mettre à jour le dashboard Yelii si un webhook global y est configuré.
      </p>
    </div>
  )
}

// ── Modal historique ───────────────────────────────────────────────────
function HistoryModal({ configKey, onClose }: { configKey: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['developer-config-history', configKey],
    queryFn: async () => (await api.get(`/developer/config/${configKey}/history`)).data.data as HistoryEntry[],
  })

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-[16px] shadow-2xl max-w-lg w-full max-h-[70vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h3 className="font-display font-semibold text-[#0F4A0F] text-sm">Historique — <span className="font-mono">{configKey}</span></h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3">
          {isLoading && <p className="text-sm text-gray-400">Chargement…</p>}
          {data?.length === 0 && <p className="text-sm text-gray-400 italic">Aucun changement enregistré.</p>}
          {data?.map(h => (
            <div key={h.id} className="p-3 bg-gray-50 rounded-[10px] text-xs">
              <p className="font-semibold text-gray-700">{formatDateTime(h.createdAt)} — {h.changedByName}</p>
              <p className="mt-1 font-mono break-all text-gray-400 line-through">{h.oldValue ?? '(valeur initiale)'}</p>
              <p className="font-mono break-all text-[#0F4A0F]">→ {h.newValue}</p>
              {h.reason && <p className="mt-1 text-gray-500 italic">Note : « {h.reason} »</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Vue principale ─────────────────────────────────────────────────────
export function Developer() {
  const [activeSection, setActiveSection] = useState<string>('WEBHOOKS')
  const [historyKey, setHistoryKey] = useState<string | null>(null)

  const { data: configs, isLoading, isError } = useQuery({
    queryKey: ['developer-config'],
    queryFn: async () => (await api.get('/developer/config')).data.data as ConfigItem[],
  })

  const sectionConfigs = useMemo(
    () => (configs ?? []).filter(c => c.category === activeSection),
    [configs, activeSection]
  )
  const webhookYelii = useMemo(() => configs?.find(c => c.key === 'YELII_WEBHOOK_URL'), [configs])

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-center p-6 animate-page-enter">
        <div className="w-20 h-20 bg-red-50 rounded-[20px] flex items-center justify-center"><ShieldAlert className="text-red-400" size={32} /></div>
        <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">Accès refusé</h2>
        <p className="text-gray-400 text-sm max-w-xs">Ce panneau est réservé au rôle DEVELOPER.</p>
      </div>
    )
  }

  return (
    <div className="animate-page-enter">
      {/* En-tête */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-[12px] bg-[#0F172A] flex items-center justify-center">
          <Terminal size={20} className="text-[#F5C400]" />
        </div>
        <div>
          <h1 className="font-display font-bold text-[#0F4A0F] text-xl leading-tight">Panneau Développeur</h1>
          <p className="text-xs text-gray-400">Configuration technique dynamique — la base de données est la source de vérité, effet immédiat sans redémarrage.</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Menu latéral propre au panneau (7 sections A-G) */}
        <nav className="lg:w-56 flex-shrink-0 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
          {SECTIONS.map(s => {
            const Icon = s.icon
            const active = activeSection === s.id
            const count = (configs ?? []).filter(c => c.category === s.id).length
            return (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={cn(
                  'flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] text-xs font-semibold whitespace-nowrap transition-all',
                  active ? 'bg-[#0F4A0F] text-white shadow-cem' : 'text-gray-500 hover:bg-gray-100'
                )}
              >
                <Icon size={15} className={active ? 'text-[#F5C400]' : 'text-gray-400'} />
                <span className="flex-1 text-left">{s.label}</span>
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', active ? 'bg-white/15' : 'bg-gray-100')}>{count}</span>
              </button>
            )
          })}
        </nav>

        {/* Contenu de la section */}
        <div className="flex-1 min-w-0 space-y-3">
          {isLoading && <div className="p-8 text-center text-sm text-gray-400">Chargement de la configuration…</div>}

          {/* §4 — carte Recalculer en tête de la section Webhooks */}
          {activeSection === 'WEBHOOKS' && !isLoading && (
            <WebhookRecalculateCard current={webhookYelii} onHistory={setHistoryKey} />
          )}

          {/* Note d'harmonisation section C (§5C : pas de doublon avec Paramètres ADMIN) */}
          {activeSection === 'FINANCIAL' && !isLoading && (
            <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-[10px] text-xs text-blue-700">
              <Info size={14} className="flex-shrink-0 mt-0.5" />
              <span>Les ratios étudiant/couple et le taux d&apos;augmentation annuel se gèrent dans <b>Paramètres</b> (page ADMIN existante) — pas de doublon ici. Cette section couvre uniquement les paramètres financiers techniques.</span>
            </div>
          )}

          {sectionConfigs
            .filter(c => !(activeSection === 'WEBHOOKS' && c.key === 'YELII_WEBHOOK_URL')) // déjà dans la carte §4
            .map(c => <ConfigRow key={c.key} config={c} onHistory={setHistoryKey} />)}

          {!isLoading && sectionConfigs.length === 0 && activeSection !== 'WEBHOOKS' && (
            <p className="p-8 text-center text-sm text-gray-400 italic">Aucun paramètre dans cette section (variable absente du .env au moment du seed).</p>
          )}
        </div>
      </div>

      {historyKey && <HistoryModal configKey={historyKey} onClose={() => setHistoryKey(null)} />}
    </div>
  )
}
