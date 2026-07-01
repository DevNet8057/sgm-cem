'use client'
import { useState } from 'react'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { PasswordInput } from '@/components/ui/PasswordInput'
import api from '@/lib/api'
import { useAuthStore } from '@/store/authStore'

export function ChangePassword() {
  const { user, setMustChangePassword } = useAuthStore()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const canSubmit = next.length >= 8 && /[A-Z]/.test(next) && /[0-9]/.test(next) && next === confirm && current.length > 0 && !loading

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setError('')
    setLoading(true)

    try {
      await api.post('/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      })
      setSuccess(true)
      setTimeout(() => setMustChangePassword(false), 1500)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setError(e.response?.data?.error?.message ?? 'Impossible de modifier le mot de passe')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#F0FDF4] flex items-center justify-center p-6">
        <div className="w-full max-w-sm text-center animate-modal-in">
          <div className="w-20 h-20 rounded-full bg-[#1A6B1A] flex items-center justify-center mx-auto mb-6 shadow-cem-lg">
            <ShieldCheck size={36} className="text-white" />
          </div>
          <h2 className="font-display font-semibold text-[#0F4A0F] text-3xl mb-2">Mot de passe sécurisé</h2>
          <p className="text-gray-500 text-sm">Redirection en cours…</p>
          <div className="mt-6 w-8 h-8 border-4 border-[#1A6B1A]/20 border-t-[#1A6B1A] rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F0FDF4] flex items-center justify-center p-6">
      <div className="w-full max-w-md animate-page-enter">
        <div
          className="rounded-[20px] p-6 mb-6 text-white relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #052005 0%, #0F4A0F 50%, #1A6B1A 100%)' }}
        >
          <div
            className="absolute -top-10 -right-10 w-40 h-40 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, #F5C400, transparent)', opacity: 0.1 }}
          />
          <div className="relative z-10 flex items-center gap-4">
            <div className="w-12 h-12 rounded-[14px] bg-[#F5C400] flex items-center justify-center shadow-cem-yellow">
              <KeyRound size={22} className="text-[#0F4A0F]" />
            </div>
            <div>
              <p className="text-white/60 text-xs mb-0.5">Première connexion</p>
              <h1 className="font-display font-semibold text-2xl leading-tight">Créez votre mot de passe</h1>
            </div>
          </div>
          <p className="mt-3 text-white/70 text-sm relative z-10">
            Bienvenue <strong>{user?.firstName}</strong> — Pour votre sécurité, veuillez créer un mot de passe personnel.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-[20px] border border-gray-100 p-6 space-y-4 shadow-[0_4px_24px_rgba(15,74,15,0.08)]">
          {/* Password actuel */}
          <PasswordInput
            label="Mot de passe temporaire reçu *"
            value={current}
            onChange={e => setCurrent(e.target.value)}
            placeholder="Mot de passe fourni par l'administrateur"
            autoComplete="current-password"
            required
          />

          {/* Nouveau password avec indicateur */}
          <PasswordInput
            label="Nouveau mot de passe *"
            value={next}
            onChange={e => setNext(e.target.value)}
            placeholder="Minimum 8 caractères, 1 majuscule, 1 chiffre"
            autoComplete="new-password"
            showStrengthIndicator={true}
            required
          />

{/* Confirmation */}
           <PasswordInput
             label="Confirmer le mot de passe *"
             value={confirm}
             onChange={e => setConfirm(e.target.value)}
             placeholder="Répétez le mot de passe"
             autoComplete="new-password"
             required
           />

          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-[10px] text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full flex items-center justify-center gap-2 py-3 bg-[#1A6B1A] text-white font-semibold rounded-[12px] shadow-cem hover:bg-[#0F4A0F] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Enregistrement…
              </>
            ) : (
              <>
                <ShieldCheck size={16} />
                Définir mon mot de passe
              </>
            )}
          </button>

          <p className="text-center text-xs text-gray-400">
            Conservez ce mot de passe en lieu sûr. Il vous sera demandé à chaque connexion.
          </p>
        </form>
      </div>
    </div>
  )
}
