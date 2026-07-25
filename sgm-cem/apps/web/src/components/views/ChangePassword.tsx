'use client'

import { Alert, Button, Card, Result } from 'antd'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
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
      <main className="flex min-h-screen items-center justify-center bg-[#07120D] p-4 font-dash sm:p-6">
        <Card
          variant="borderless"
          className="w-full max-w-md overflow-hidden rounded-[20px] border border-white/[.06] bg-[#0E1C16] shadow-[0_8px_30px_rgba(0,0,0,.25)]"
          styles={{ body: { padding: 0 } }}
        >
          <Result
            status="success"
            icon={(
              <span className="mx-auto flex size-20 items-center justify-center rounded-full bg-emerald-500/15 text-[#2ECC71]">
                <ShieldCheck size={38} strokeWidth={1.8} aria-hidden="true" />
              </span>
            )}
            title={(
              <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em] text-white sm:text-3xl">
                Mot de passe sécurisé
              </h1>
            )}
            subTitle={(
              <p className="m-0 text-[15px] text-[#94A3B8]" aria-live="polite">
                Votre espace est prêt. Redirection en cours…
              </p>
            )}
            className="px-4 py-8 sm:px-8 sm:py-10"
          />
        </Card>
      </main>
    )
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-[#07120D] p-4 font-dash sm:p-6"
      aria-labelledby="change-password-title"
    >
      <div className="w-full max-w-md space-y-4 sm:space-y-6">
        <Card
          variant="borderless"
          className="relative overflow-hidden rounded-[20px] border border-white/[.06] bg-[#081A12] shadow-[0_8px_30px_rgba(0,0,0,.25)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_20px_40px_rgba(0,0,0,.35)]"
          styles={{ body: { padding: 0 } }}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: 'radial-gradient(circle at 85% 10%, rgba(46,204,113,.16), transparent 42%), linear-gradient(135deg, rgba(46,204,113,.08), transparent 62%)',
            }}
            aria-hidden="true"
          />
          <div className="relative p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-[#2ECC71] to-[#22C55E] text-[#07120D] shadow-[0_8px_24px_rgba(46,204,113,.18)]">
                <KeyRound size={22} strokeWidth={2} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="mb-1 text-[13px] font-medium uppercase tracking-[0.12em] text-[#94A3B8]">
                  Première connexion
                </p>
                <h1
                  id="change-password-title"
                  className="m-0 text-2xl font-semibold leading-tight tracking-[-0.03em] text-white sm:text-[30px]"
                >
                  Créez votre mot de passe
                </h1>
              </div>
            </div>
            <p className="relative mt-5 text-[15px] leading-6 text-[#94A3B8]">
              Bienvenue <strong className="font-semibold text-white">{user?.firstName}</strong>. Pour votre sécurité,
              définissez un mot de passe personnel avant de continuer.
            </p>
          </div>
        </Card>

        <Card
          variant="borderless"
          className="rounded-[20px] border border-white/[.06] bg-[#0E1C16] shadow-[0_8px_30px_rgba(0,0,0,.25)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_20px_40px_rgba(0,0,0,.35)]"
          styles={{ body: { padding: 0 } }}
        >
          <form onSubmit={handleSubmit} className="space-y-5 p-5 sm:p-6">
            <PasswordInput
              label="Mot de passe temporaire reçu *"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              placeholder="Mot de passe fourni par l’administrateur"
              autoComplete="current-password"
              required
            />

            <PasswordInput
              label="Nouveau mot de passe *"
              value={next}
              onChange={e => setNext(e.target.value)}
              placeholder="Minimum 8 caractères, 1 majuscule, 1 chiffre"
              autoComplete="new-password"
              showStrengthIndicator={true}
              required
            />

            <PasswordInput
              label="Confirmer le mot de passe *"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Répétez le mot de passe"
              autoComplete="new-password"
              required
            />

            {error && (
              <Alert
                type="error"
                showIcon
                message="Modification impossible"
                description={error}
                className="rounded-[14px] border-red-500/25 bg-red-500/10 text-red-200"
              />
            )}

            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              disabled={!canSubmit}
              icon={!loading ? <ShieldCheck size={17} strokeWidth={2} aria-hidden="true" /> : undefined}
              block
              className="h-[46px] rounded-[14px] border-0 bg-gradient-to-r from-[#2ECC71] to-[#22C55E] font-semibold text-[#07120D] shadow-[0_8px_24px_rgba(46,204,113,.16)] transition-[transform,box-shadow] duration-200 hover:scale-[1.02] hover:shadow-[0_12px_30px_rgba(46,204,113,.22)]"
            >
              {loading ? 'Enregistrement…' : 'Définir mon mot de passe'}
            </Button>

            <p className="text-center text-[13px] leading-5 text-[#94A3B8]">
              Conservez ce mot de passe en lieu sûr. Il vous sera demandé à chaque connexion.
            </p>
          </form>
        </Card>
      </div>
    </main>
  )
}
