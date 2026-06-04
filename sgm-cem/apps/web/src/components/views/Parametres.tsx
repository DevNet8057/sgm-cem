'use client'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Save, Settings, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import api from '@/lib/api'
import { formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import type { ApiResponse, SystemSettings } from '@/types'

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
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">Parametres systeme</h2>
          <p className="text-gray-500 text-sm">Regles financieres, rappels et identite du ministere</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RefreshCw size={14} />
          Actualiser
        </Button>
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
          <div className="rounded-[18px] border border-gray-100 bg-white p-5">
            <h3 className="font-display font-semibold text-[#0F4A0F] mb-3">Controle d'acces</h3>
            <p className="text-sm leading-relaxed text-gray-600">
              Cette page est reservee aux tresoriers et administrateurs. Chaque modification est inscrite dans les journaux d'audit.
            </p>
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
