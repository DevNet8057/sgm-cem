'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check, Copy, Edit3, KeyRound, LogIn, Plus, RefreshCw, Shield,
  ToggleLeft, ToggleRight, UserCog, Users, X,
} from 'lucide-react'
import api from '@/lib/api'
import { cn, formatDate, ROLE_LABELS } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Avatar } from '@/components/ui/Avatar'
import type { User, UserRole } from '@/types'

const ROLES: { value: UserRole; label: string; color: string }[] = [
  { value: 'ADMIN',               label: 'Administrateur',   color: 'bg-violet-100 text-violet-700' },
  { value: 'TRESORIER',           label: 'Trésorier',         color: 'bg-[#E8F5E8] text-[#1A6B1A]'  },
  { value: 'RESPONSABLE',         label: 'Responsable',       color: 'bg-blue-100 text-blue-700'    },
  { value: 'ADJOINT_RESPONSABLE', label: 'Adjoint Resp.',     color: 'bg-sky-100 text-sky-700'       },
  { value: 'COLLECTEUR',          label: 'Collecteur',        color: 'bg-yellow-100 text-yellow-800' },
  { value: 'MEMBRE',              label: 'Membre',            color: 'bg-gray-100 text-gray-600'     },
]

const emptyForm = { firstName: '', lastName: '', email: '', phone: '', role: 'MEMBRE' as UserRole, password: '' }

export function GestionUtilisateurs() {
  const queryClient = useQueryClient()
  const { user: currentUser } = useAuthStore()
  // Bouton "Connecter" (impersonation) : outil réservé au rôle DEVELOPER
  const isDeveloper = currentUser?.role === 'DEVELOPER'
  const [showCreate, setShowCreate] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [copiedPassword, setCopiedPassword] = useState('')
  const [resetTarget, setResetTarget] = useState<User | null>(null)
  const [resetPassword, setResetPassword] = useState('')

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/users')).data.data,
  })

  const create = useMutation({
    mutationFn: async () => api.post('/users', {
      ...form,
      password: form.password || undefined,
    }),
    onSuccess: async (res) => {
      const tmp: string = res.data.data?.temporaryPassword
      if (tmp) { setCopiedPassword(tmp); navigator.clipboard?.writeText(tmp).catch(() => {}) }
      setShowCreate(false)
      setForm(emptyForm)
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: showApiError,
  })

  const update = useMutation({
    mutationFn: async () => api.patch(`/users/${editingUser?.id}`, {
      firstName: form.firstName || undefined,
      lastName: form.lastName || undefined,
      email: form.email || undefined,
      phone: form.phone || null,
      role: form.role,
    }),
    onSuccess: async () => {
      setEditingUser(null)
      setForm(emptyForm)
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: showApiError,
  })

  const toggleActive = useMutation({
    mutationFn: async (id: string) => api.patch(`/users/${id}/toggle-active`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: showApiError,
  })

  // Impersonation — bascule la session vers le compte cible puis recharge
  // l'app entière (cookie + CSRF + /me + caches React Query resynchronisés).
  const impersonate = useMutation({
    mutationFn: async (id: string) => api.post(`/developer/impersonate/${id}`),
    onSuccess: () => { window.location.reload() },
    onError: showApiError,
  })

  function askImpersonate(u: User) {
    if (window.confirm(
      `Se connecter en tant que ${u.fullName} (${ROLE_LABELS[u.role] ?? u.role}) ?\n\n` +
      `Vous verrez l'application exactement comme cet utilisateur (durée max 1 h).\n` +
      `Cette action est enregistrée dans l'audit.`
    )) {
      impersonate.mutate(u.id)
    }
  }

  const resetPwd = useMutation({
    mutationFn: async () => api.post(`/users/${resetTarget?.id}/reset-password`, {
      password: resetPassword || undefined,
    }),
    onSuccess: async (res) => {
      const tmp: string = res.data.data?.temporaryPassword
      if (tmp) { setCopiedPassword(tmp); navigator.clipboard?.writeText(tmp).catch(() => {}) }
      setResetTarget(null)
      setResetPassword('')
      await queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: showApiError,
  })

  function showApiError(err: unknown) {
    const e = err as { response?: { data?: { error?: { message?: string } } } }
    setError(e.response?.data?.error?.message ?? 'Opération impossible')
  }

  function startEdit(u: User) {
    setEditingUser(u)
    setForm({ firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone ?? '', role: u.role, password: '' })
    setError('')
  }

  const roleCount = ROLES.map(r => ({
    ...r,
    count: users.filter(u => u.role === r.value).length,
  }))

  return (
    <div className="p-4 md:p-6 pb-20 lg:pb-6 animate-page-enter">
      {/* Header */}
      <div className="relative overflow-hidden rounded-[18px] border border-[#0F4A0F]/10 bg-white mb-6">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-violet-500" />
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-violet-600">Administration</p>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-2xl">Gestion des utilisateurs</h2>
            <p className="text-gray-500 text-sm mt-0.5">{users.length} compte(s) enregistré(s)</p>
          </div>
          <Button size="sm" onClick={() => { setShowCreate(true); setForm(emptyForm); setError('') }}>
            <Plus size={14} />
            Créer un compte
          </Button>
        </div>
      </div>

      {/* Rôles KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        {roleCount.map(r => (
          <div key={r.value} className="bg-white rounded-[14px] border border-gray-100 p-3 text-center">
            <span className={cn('inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold mb-1', r.color)}>
              {r.label}
            </span>
            <p className="font-display font-bold text-2xl text-[#0F4A0F]">{r.count}</p>
          </div>
        ))}
      </div>

      {/* Notification mot de passe copié */}
      {copiedPassword && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[12px] bg-[#E8F5E8] border border-[#1A6B1A]/30 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-[#0F4A0F]">
            <Check size={16} className="text-[#1A6B1A]" />
            <span>Mot de passe temporaire copié dans le presse-papiers :</span>
            <code className="font-mono font-bold bg-white px-2 py-0.5 rounded border border-[#1A6B1A]/20">{copiedPassword}</code>
          </div>
          <button onClick={() => setCopiedPassword('')} className="text-gray-400 hover:text-gray-700">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden shadow-[0_2px_12px_rgba(15,74,15,0.06)]">
        <div className="px-5 py-4 flex items-center justify-between"
          style={{ background: 'linear-gradient(135deg, #0F4A0F, #1A6B1A)' }}>
          <h3 className="font-display font-semibold text-white text-sm">Comptes utilisateurs</h3>
          <span className="text-white/60 text-xs bg-white/10 px-2.5 py-1 rounded-full">{users.length} au total</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm table-mobile-cards">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                {['Utilisateur', 'Email', 'Rôle', 'Statut', 'Dernière connexion', 'Actions'].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonTableRow key={i} cols={6} />)
              ) : users.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 text-sm">
                  <Users size={32} className="mx-auto mb-2 opacity-30" />
                  Aucun utilisateur enregistré
                </td></tr>
              ) : (
                users.map(u => (
                  <tr key={u.id} className={cn('border-b border-gray-50 transition-colors', u.isActive ? 'hover:bg-gray-50/60' : 'bg-red-50/20 hover:bg-red-50/40')}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.fullName} size="sm" />
                        <div>
                          <p className="font-medium text-gray-800">{u.fullName}</p>
                          {u.mustChangePassword && (
                            <span className="text-[10px] text-amber-600 font-semibold bg-amber-50 px-1.5 py-0.5 rounded">
                              Doit changer le mdp
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 font-mono" data-label="Email">{u.email}</td>
                    <td className="px-4 py-3" data-label="Rôle">
                      <StatusBadge status={u.role as Parameters<typeof StatusBadge>[0]['status']} dot={false} />
                    </td>
                    <td className="px-4 py-3" data-label="Statut">
                      <span className={cn('inline-flex items-center gap-1 text-xs font-semibold rounded-full px-2.5 py-0.5',
                        u.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700')}>
                        <span className={cn('w-1.5 h-1.5 rounded-full', u.isActive ? 'bg-green-500' : 'bg-red-500')} />
                        {u.isActive ? 'Actif' : 'Désactivé'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400" data-label="Dernière connexion">
                      {u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Jamais connecté'}
                    </td>
                    <td className="px-4 py-3" data-label="Actions">
                      <div className="flex gap-1.5">
                        {/* Connecter (impersonation) — DEVELOPER uniquement, cible active non-DEVELOPER */}
                        {isDeveloper && u.isActive && u.role !== 'DEVELOPER' && u.id !== currentUser?.id && (
                          <button
                            title={`Se connecter en tant que ${u.fullName}`}
                            onClick={() => askImpersonate(u)}
                            disabled={impersonate.isPending}
                            className="h-7 px-2 flex items-center gap-1 rounded-[7px] border border-[#0F172A]/20 bg-[#0F172A] text-[#F5C400] text-[10px] font-bold hover:bg-[#1E293B] transition-colors disabled:opacity-50"
                          >
                            <LogIn size={11} />
                            Connecter
                          </button>
                        )}
                        <button title="Modifier" onClick={() => startEdit(u)}
                          className="w-7 h-7 flex items-center justify-center rounded-[7px] border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors">
                          <Edit3 size={12} />
                        </button>
                        <button title="Réinitialiser mot de passe" onClick={() => { setResetTarget(u); setResetPassword('') }}
                          className="w-7 h-7 flex items-center justify-center rounded-[7px] border border-gray-200 text-gray-500 hover:bg-yellow-50 hover:border-yellow-300 hover:text-yellow-700 transition-colors">
                          <KeyRound size={12} />
                        </button>
                        <button
                          title={u.isActive ? 'Désactiver' : 'Activer'}
                          onClick={() => toggleActive.mutate(u.id)}
                          className={cn(
                            'w-7 h-7 flex items-center justify-center rounded-[7px] border transition-colors',
                            u.isActive
                              ? 'border-gray-200 text-gray-500 hover:bg-red-50 hover:border-red-200 hover:text-red-600'
                              : 'border-green-200 text-green-600 hover:bg-green-50'
                          )}>
                          {u.isActive ? <ToggleRight size={12} /> : <ToggleLeft size={12} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal création */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); setError('') }}
        title="Créer un compte utilisateur"
        description="Le compte sera créé avec un mot de passe temporaire que l'utilisateur devra changer à la première connexion.">
        <form onSubmit={e => { e.preventDefault(); create.mutate() }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prénom *" value={form.firstName} onChange={v => setForm(f => ({ ...f, firstName: v }))} required />
            <Field label="Nom *" value={form.lastName} onChange={v => setForm(f => ({ ...f, lastName: v }))} required />
          </div>
          <Field label="Adresse email *" type="email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} required />
          <Field label="Téléphone" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} />
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Rôle *</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as UserRole }))}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30">
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <PasswordInput
            label="Mot de passe temporaire (laissez vide = 'CEM@2026!')"
            value={form.password}
            onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
            placeholder="Optionnel - Laissez vide pour mot de passe par défaut"
          />
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-[10px] px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button type="button" variant="ghost" onClick={() => { setShowCreate(false); setError('') }}>Annuler</Button>
            <Button loading={create.isPending}><UserCog size={14} /> Créer le compte</Button>
          </div>
        </form>
      </Modal>

      {/* Modal édition */}
      <Modal open={editingUser !== null} onClose={() => { setEditingUser(null); setError('') }}
        title={`Modifier — ${editingUser?.fullName}`}>
        <form onSubmit={e => { e.preventDefault(); update.mutate() }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prénom" value={form.firstName} onChange={v => setForm(f => ({ ...f, firstName: v }))} />
            <Field label="Nom" value={form.lastName} onChange={v => setForm(f => ({ ...f, lastName: v }))} />
          </div>
          <Field label="Email" type="email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} />
          <Field label="Téléphone" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} />
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Rôle</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as UserRole }))}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30">
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-[10px] px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button type="button" variant="ghost" onClick={() => { setEditingUser(null); setError('') }}>Annuler</Button>
            <Button loading={update.isPending}><Check size={14} /> Enregistrer</Button>
          </div>
        </form>
      </Modal>

      {/* Modal reset password */}
      <Modal open={resetTarget !== null} onClose={() => { setResetTarget(null); setError('') }}
        title={`Réinitialiser le mot de passe`}
        description={`Le compte de ${resetTarget?.fullName} sera déconnecté de toutes les sessions.`}>
        <div className="space-y-4">
          <PasswordInput
            label="Nouveau mot de passe temporaire (laissez vide = 'CEM@2026!')"
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
            placeholder="Optionnel - Laissez vide pour mot de passe par défaut"
          />
          <div className="flex items-start gap-2 rounded-[10px] bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
            <RefreshCw size={13} className="mt-0.5 shrink-0" />
            L&apos;utilisateur devra changer son mot de passe à la prochaine connexion.
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-[10px] px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button type="button" variant="ghost" onClick={() => setResetTarget(null)}>Annuler</Button>
            <Button variant="yellow" loading={resetPwd.isPending} onClick={() => resetPwd.mutate()}>
              <KeyRound size={14} /> Réinitialiser
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', required }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-600 block mb-1.5">{label}</label>
      <input type={type} required={required} value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30" />
    </div>
  )
}
