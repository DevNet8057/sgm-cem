'use client'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Info, Play, RefreshCw, Save, Settings, ShieldCheck, SlidersHorizontal, TrendingUp } from 'lucide-react'
import api from '@/lib/api'
import { formatAmount, formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import type { ApiResponse, SystemSettings } from '@/types'

// ── C4 : sons de notification générés par Web Audio API (pas de fichiers audio requis) ──
const NOTIF_SOUNDS: Array<{ id: string; label: string; play: () => void }> = [
  {
    id: 'bip',
    label: 'Bip standard',
    play: () => {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'; osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.25)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
      osc.start(); osc.stop(ctx.currentTime + 0.35)
    },
  },
  {
    id: 'double',
    label: 'Double bip',
    play: () => {
      const ctx = new AudioContext()
      ;[0, 0.18].forEach(delay => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.type = 'sine'; osc.frequency.value = 1050
        gain.gain.setValueAtTime(0.25, ctx.currentTime + delay)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.12)
        osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.14)
      })
    },
  },
  {
    id: 'aigu',
    label: 'Bip aigu',
    play: () => {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'; osc.frequency.value = 1400
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
      osc.start(); osc.stop(ctx.currentTime + 0.2)
    },
  },
  {
    id: 'grave',
    label: 'Bip grave',
    play: () => {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'triangle'; osc.frequency.value = 440
      gain.gain.setValueAtTime(0.35, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc.start(); osc.stop(ctx.currentTime + 0.4)
    },
  },
  {
    id: 'off',
    label: 'Silence',
    play: () => {},
  },
]

const SOUND_STORAGE_KEY = 'cem-notif-sound'
function getSavedSoundId(): string { return typeof window !== 'undefined' ? (localStorage.getItem(SOUND_STORAGE_KEY) ?? 'bip') : 'bip' }
function saveSoundId(id: string): void { if (typeof window !== 'undefined') localStorage.setItem(SOUND_STORAGE_KEY, id) }

type SettingsForm = {
  defaultIncreaseRate: string
  etudiantRatio: string
  coupleRatio: string
  inactivityMonthsThreshold: string
  reminderDelayDays: string
  maxFundsRetentionDays: string
  communityName: string
  communityVerse: string
}

const emptyForm: SettingsForm = {
  defaultIncreaseRate: '',
  etudiantRatio: '',
  coupleRatio: '',
  inactivityMonthsThreshold: '',
  reminderDelayDays: '',
  maxFundsRetentionDays: '',
  communityName: '',
  communityVerse: '',
}

export function Parametres() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<SettingsForm>(emptyForm)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [simAmount, setSimAmount] = useState('25000')
  const [selectedSound, setSelectedSound] = useState(getSavedSoundId)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await api.get<ApiResponse<SystemSettings>>('/settings')
      return res.data.data!
    },
  })

  useEffect(() => {
    if (!data) return
    setForm({
      defaultIncreaseRate: String(data.defaultIncreaseRate),
      etudiantRatio: String(data.etudiantRatio),
      coupleRatio: String(data.coupleRatio),
      inactivityMonthsThreshold: String(data.inactivityMonthsThreshold),
      reminderDelayDays: String(data.reminderDelayDays),
      maxFundsRetentionDays: String(data.maxFundsRetentionDays),
      communityName: data.communityName,
      communityVerse: data.communityVerse,
    })
  }, [data])

  const save = useMutation({
    mutationFn: async () => api.patch('/settings', serialize(form)),
    onSuccess: async () => {
      setError('')
      setSaved('Parametres enregistres')
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      setTimeout(() => setSaved(''), 3500)
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setSaved('')
      setError(e.response?.data?.error?.message ?? 'Enregistrement impossible')
    },
  })

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-gray-600" />
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-600">Administration</p>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Paramètres système</h2>
            <p className="text-gray-500 text-sm mt-0.5">Règles financières, rappels et identité du ministère</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw size={14} />
            Actualiser
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
        <form onSubmit={e => { e.preventDefault(); save.mutate() }} className="space-y-5">
          <Panel icon={Settings} title="Identite CEM">
            <Input label="Nom de la communaute" value={form.communityName} onChange={communityName => setForm({ ...form, communityName })} required />
            <label className="block md:col-span-2">
              <span className="text-xs font-semibold text-gray-600">Verset / devise</span>
              <textarea
                rows={4}
                value={form.communityVerse}
                onChange={e => setForm({ ...form, communityVerse: e.target.value })}
                className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30"
              />
            </label>
          </Panel>

          <Panel icon={SlidersHorizontal} title="Regles financieres">
            <Input label="Hausse annuelle par defaut (%)" type="number" step="0.1" value={form.defaultIncreaseRate} onChange={defaultIncreaseRate => setForm({ ...form, defaultIncreaseRate })} required />
            <Input label="Ratio etudiant" type="number" step="0.1" value={form.etudiantRatio} onChange={etudiantRatio => setForm({ ...form, etudiantRatio })} required />
            <Input label="Ratio couple" type="number" step="0.1" value={form.coupleRatio} onChange={coupleRatio => setForm({ ...form, coupleRatio })} required />
          </Panel>

          <Panel icon={ShieldCheck} title="Suivi et controle">
            <Input label="Inactivite apres mois" type="number" value={form.inactivityMonthsThreshold} onChange={inactivityMonthsThreshold => setForm({ ...form, inactivityMonthsThreshold })} required />
            <Input label="Delai rappel (jours)" type="number" value={form.reminderDelayDays} onChange={reminderDelayDays => setForm({ ...form, reminderDelayDays })} required />
            <Input label="Retention max fonds (jours)" type="number" value={form.maxFundsRetentionDays} onChange={maxFundsRetentionDays => setForm({ ...form, maxFundsRetentionDays })} required />
          </Panel>

          {error && <div className="rounded-[10px] border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
          {saved && <div className="rounded-[10px] border border-green-100 bg-green-50 px-4 py-3 text-sm text-[#1A6B1A]">{saved}</div>}

          <div className="flex justify-end">
            <Button loading={save.isPending}>
              <Save size={16} />
              Enregistrer
            </Button>
          </div>
        </form>

        <aside className="space-y-4">
          {/* E : Simulateur de ratios en temps réel */}
          <div className="rounded-[18px] border border-[#1A6B1A]/20 bg-white p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-9 h-9 rounded-[10px] bg-[#E8F5E8] text-[#1A6B1A] flex items-center justify-center">
                <TrendingUp size={16} />
              </div>
              <h3 className="font-display font-semibold text-[#0F4A0F]">Simulateur de ratios</h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">Saisissez un montant de référence (travailleur) pour voir les montants calculés par profil.</p>
            <input
              type="number"
              value={simAmount}
              onChange={e => setSimAmount(e.target.value)}
              placeholder="Montant travailleur (FCFA)"
              className="w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 mb-3 font-mono"
            />
            {(() => {
              const base = Number(simAmount) || 0
              const etudiant = Math.round(base * (Number(form.etudiantRatio) || 0.5))
              const couple = Math.round(base * (Number(form.coupleRatio) || 1.5))
              const nextYear = Math.round(base * (1 + (Number(form.defaultIncreaseRate) || 5) / 100))
              return (
                <div className="space-y-2">
                  {[
                    { label: 'Travailleur', amount: base, ratio: '× 1.00', color: 'bg-[#E8F5E8] text-[#1A6B1A]' },
                    { label: 'Etudiant',    amount: etudiant, ratio: `× ${form.etudiantRatio || '0.5'}`, color: 'bg-blue-50 text-blue-700' },
                    { label: 'Couple',      amount: couple, ratio: `× ${form.coupleRatio || '1.5'}`, color: 'bg-purple-50 text-purple-700' },
                    { label: 'N+1 (travailleur)', amount: nextYear, ratio: `+${form.defaultIncreaseRate || '5'}%`, color: 'bg-amber-50 text-amber-700' },
                  ].map(row => (
                    <div key={row.label} className={cn('flex items-center justify-between rounded-[10px] px-3 py-2', row.color)}>
                      <span className="text-xs font-semibold">{row.label}</span>
                      <div className="text-right">
                        <span className="font-mono font-bold text-sm">{formatAmount(row.amount)}</span>
                        <span className="text-[10px] ml-1.5 opacity-70">{row.ratio}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* C4 : Sélecteur de son de notification */}
          <div className="rounded-[18px] border border-[#1A6B1A]/20 bg-white p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-9 h-9 rounded-[10px] bg-[#E8F5E8] text-[#1A6B1A] flex items-center justify-center">
                <Bell size={16} />
              </div>
              <h3 className="font-display font-semibold text-[#0F4A0F]">Son de notification</h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">Choisissez le son joué à chaque nouvelle notification.</p>
            <div className="space-y-2">
              {NOTIF_SOUNDS.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setSelectedSound(s.id); saveSoundId(s.id) }}
                  className={cn(
                    'w-full flex items-center justify-between rounded-[10px] px-3 py-2.5 border text-sm font-medium transition-all',
                    selectedSound === s.id
                      ? 'bg-[#E8F5E8] border-[#1A6B1A]/30 text-[#1A6B1A]'
                      : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-[#1A6B1A]/30'
                  )}
                >
                  <span>{s.label}</span>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); s.play() }}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-[#1A6B1A] transition-colors"
                    title="Tester ce son"
                  >
                    <Play size={11} />
                    Tester
                  </button>
                </button>
              ))}
            </div>
            {selectedSound === 'off' && (
              <p className="mt-2 text-xs text-amber-600">Les notifications in-app resteront visibles, mais sans son.</p>
            )}
          </div>

          <div className="rounded-[18px] border border-gray-100 bg-white p-5">
            <div className="flex items-start gap-2">
              <Info size={14} className="text-gray-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">Contrôle d&apos;accès</p>
                <p className="text-xs leading-relaxed text-gray-500">
                  Page réservée aux trésoriers et administrateurs. Chaque modification est inscrite dans les journaux d&apos;audit.
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-[18px] border border-gray-100 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Derniere mise a jour</p>
            <p className="mt-2 font-mono text-sm text-gray-700">
              {isLoading ? 'Chargement...' : data?.updatedAt ? formatDateTime(data.updatedAt) : '-'}
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Panel({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] border border-gray-100 bg-white p-4 md:p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#E8F5E8] text-[#1A6B1A]">
          <Icon size={18} />
        </div>
        <h3 className="font-display font-semibold text-[#0F4A0F]">{title}</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>
    </section>
  )
}

function Input({ label, value, onChange, type = 'text', step, required }: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  step?: string
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-600">{label}</span>
      <input
        type={type}
        step={step}
        required={required}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30"
      />
    </label>
  )
}

function serialize(form: SettingsForm) {
  return {
    defaultIncreaseRate: Number(form.defaultIncreaseRate),
    etudiantRatio: Number(form.etudiantRatio),
    coupleRatio: Number(form.coupleRatio),
    inactivityMonthsThreshold: Number(form.inactivityMonthsThreshold),
    reminderDelayDays: Number(form.reminderDelayDays),
    maxFundsRetentionDays: Number(form.maxFundsRetentionDays),
    communityName: form.communityName,
    communityVerse: form.communityVerse,
  }
}
