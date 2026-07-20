'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  AlertCircle, ArrowLeft, Loader2,
  Lock, Mail, Phone, RefreshCw, HelpCircle, MessageCircle, ShieldCheck,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Card, Form, Input, Modal, Tabs, Typography } from 'antd'
import { motion, useReducedMotion } from 'framer-motion'
import { useAuthStore } from '@/store/authStore'
import { BrandMark } from '@/components/ui/BrandMark'
import { cn } from '@/lib/utils'
import api from '@/lib/api'

/* ── Types Google GSI ────────────────────────────────────────────── */
declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize(c: any): void
      prompt(opt?: any): Promise<any>
      renderButton(parent: HTMLElement, options: any): void
    } } }
  }
}

const emailSchema = z.object({
  email:    z.string().email('Adresse email invalide'),
  password: z.string().min(6, 'Mot de passe trop court'),
})
type EmailForm = z.infer<typeof emailSchema>

/* ── Composant OTP 6 cases ───────────────────────────────────────── */
function OtpInput({ value, onChange, disabled }: {
  value: string; onChange: (v: string) => void; disabled?: boolean
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.padEnd(6, '').split('').slice(0, 6)

  function handle(i: number, v: string) {
    if (!/^\d*$/.test(v)) return
    const next = [...digits]; next[i] = v.slice(-1)
    onChange(next.join(''))
    if (v && i < 5) refs.current[i + 1]?.focus()
  }
  function onKey(i: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus()
  }
  function onPaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    onChange(pasted.padEnd(6, '').slice(0, 6))
    refs.current[Math.min(pasted.length, 5)]?.focus()
  }

  return (
    <div className="grid w-full grid-cols-6 gap-2" onPaste={onPaste} role="group" aria-label="Code de vérification à 6 chiffres">
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el }}
          type="text" inputMode="numeric" maxLength={1}
          value={digits[i] ?? ''}
          onChange={e => handle(i, e.target.value)}
          onKeyDown={e => onKey(i, e)}
          disabled={disabled}
          aria-label={`Chiffre ${i + 1} sur 6`}
          suppressHydrationWarning
          className={cn(
            'h-12 min-w-0 w-full text-center text-lg font-bold border-2 rounded-[10px] transition-all focus:outline-none',
            digits[i] ? 'bg-[#E8F5E8] text-[#1A6B1A] border-[#1A6B1A]'
                      : 'bg-white text-gray-800 border-gray-200 focus:border-[#1A6B1A]',
            disabled && 'opacity-50'
          )}
        />
      ))}
    </div>
  )
}

/* ── Page Login ──────────────────────────────────────────────────── */
export default function LoginPage() {
  const reduceMotion = useReducedMotion()
  const [tab, setTab] = useState<'email' | 'phone'>('email')
  const [showPwd, setShowPwd]  = useState(false)
  const [apiError, setApiError] = useState('')

  /* Google */
  const googleBtnRef   = useRef<HTMLDivElement>(null)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleBtnReady, setGoogleBtnReady] = useState(false)

  /* Mot de passe oublié */
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotError, setForgotError] = useState('')
  const [forgotResult, setForgotResult] = useState<{
    method: 'google' | 'admin_contact'
    message: string
    admin?: { fullName: string; email: string; phone: string | null } | null
  } | null>(null)

  /* Phone / OTP */
  const [phone,    setPhone]    = useState('')
  const [phoneErr, setPhoneErr] = useState('')
  const [otpSent,  setOtpSent]  = useState(false)
  const [otp,      setOtp]      = useState('')
  const [countdown, setCountdown] = useState(0)
  const [sendingOtp,  setSendingOtp]  = useState(false)
  const [verifyingOtp, setVerifyingOtp] = useState(false)

  const { login, loginWithGoogle, loginWithPhone } = useAuthStore()
  const router = useRouter()

  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<EmailForm>({
    resolver: zodResolver(emailSchema),
  })

  /* ── Countdown OTP ── */
  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  /* ── Callback Google ── */
  const handleGoogleCredential = useCallback(async (response: { credential: string }) => {
    setGoogleLoading(true)
    setApiError('')
    try {
      await loginWithGoogle(response.credential)
      router.replace('/dashboard')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setApiError(e?.response?.data?.error?.message ?? 'Connexion Google impossible')
    } finally {
      setGoogleLoading(false)
    }
  }, [loginWithGoogle, router])

  /* ── Initialiser Google (sans prompt automatique) ── */
  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    if (!clientId) return

    let disposed = false
    let attempts = 0
    const tryInit = () => {
      attempts++
      if (disposed) return
      try {
        if (window.google?.accounts?.id) {
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: handleGoogleCredential,
            auto_select: false,
            cancel_on_tap_outside: true,
            // FedCM évite le blocage de popup par Chrome moderne et le
            // blocage des cookies tiers (source des erreurs "popup blocked").
            use_fedcm_for_prompt: true,
            itp_support: true,
          })
          if (googleBtnRef.current) {
            window.google.accounts.id.renderButton(googleBtnRef.current, {
              type: 'standard',
              theme: 'outline',
              size: 'large',
              shape: 'pill',
              text: 'continue_with',
              locale: 'fr',
              width: googleBtnRef.current.offsetWidth || 300,
            })
          }
          setGoogleBtnReady(true)
        } else if (attempts < 20) {
          setTimeout(tryInit, 250)
        }
      } catch {}
    }
    tryInit()
    return () => {
      disposed = true
      setGoogleBtnReady(false)
      if (googleBtnRef.current) {
        try { googleBtnRef.current.innerHTML = '' } catch {}
      }
    }
  }, [handleGoogleCredential])

  /* ── Mot de passe oublié ── */
  function openForgotModal() {
    setForgotEmail('')
    setForgotResult(null)
    setForgotError('')
    setForgotOpen(true)
  }

  async function submitForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!forgotEmail.trim()) return
    setForgotError('')
    setForgotLoading(true)
    try {
      const res = await api.post('/auth/forgot-password', { email: forgotEmail.trim() })
      setForgotResult(res.data.data)
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { error?: { message?: string } } } }
      setForgotError(e2?.response?.data?.error?.message ?? "Une erreur est survenue. Réessayez.")
    } finally {
      setForgotLoading(false)
    }
  }

  /* ── Login email ── */
  const onEmailSubmit = async (data: EmailForm) => {
    setApiError('')
    try {
      await login(data.email, data.password)
      router.replace('/dashboard')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setApiError(e?.response?.data?.error?.message ?? 'Identifiants incorrects')
    }
  }

  /* ── Envoyer OTP ── */
  async function sendOtp() {
    const normalized = phone.replace(/\D/g, '')
    if (normalized.length < 9) { setPhoneErr('Numéro invalide (9 chiffres minimum)'); return }
    setPhoneErr(''); setSendingOtp(true)
    try {
      await api.post('/auth/otp/request', { phone: normalized })
      setOtpSent(true); setCountdown(60)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setPhoneErr(e?.response?.data?.error?.message ?? 'Envoi impossible. Vérifiez votre numéro.')
    } finally { setSendingOtp(false) }
  }

  /* ── Vérifier OTP ── */
  async function verifyOtp() {
    if (otp.length < 6) return
    setApiError(''); setVerifyingOtp(true)
    try {
      await loginWithPhone(phone.replace(/\D/g, ''), otp)
      router.replace('/dashboard')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setApiError(e?.response?.data?.error?.message ?? 'Code OTP invalide ou expiré')
    } finally { setVerifyingOtp(false) }
  }

  return (
    <main className="auth-public-background min-h-[100dvh] bg-[#f3f7f3] lg:grid lg:grid-cols-[minmax(380px,40%)_1fr]">
      {/* ── Panneau gauche (desktop) ── */}
      <aside
        className="hidden lg:flex flex-col justify-center px-12 py-8 relative overflow-hidden cross-bg"
        style={{ background: 'linear-gradient(160deg,#052005 0%,#0F4A0F 45%,#1A6B1A 100%)' }}
      >
        <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle,#F5C400,transparent)', opacity: 0.08 }} />

        <div className="relative z-10 w-full max-w-[520px]">
          <BrandMark size={48} variant="compact" alt="Logo CEM" className="mb-6" />
          <h1 className="font-display text-white text-[clamp(32px,3vw,36px)] font-semibold leading-tight mb-4">
            Système de Gestion<br />du Ministère
          </h1>
          <p className="text-white/65 text-sm leading-relaxed mb-8">
            Culte d&apos;Enfants de Melen · Église Évangélique du Cameroun, Yaoundé
          </p>
          <div className="space-y-4 mb-8" aria-label="Avantages de SGM-CEM">
            {['Suivi clair des contributions', 'Gestion centralisée des membres', 'Données sécurisées et traçables'].map(benefit => (
              <div key={benefit} className="flex items-center gap-3 text-sm text-white/85">
                <ShieldCheck size={18} className="shrink-0 text-[#F5C400]" aria-hidden="true" />
                <span>{benefit}</span>
              </div>
            ))}
          </div>
          <div className="rounded-[16px] p-4" style={{ background: 'rgba(245,196,0,0.10)' }}>
            <p className="text-white/80 text-sm leading-relaxed">
              &quot;La gestion transparente des ressources, au service de la communauté et de la gloire de Dieu.&quot;
            </p>
          </div>
        </div>
      </aside>

      {/* ── Formulaire droite — scrollable sur mobile, centré sur desktop ── */}
      <section className="flex min-h-[100dvh] items-center justify-center overflow-y-auto px-4 py-6 sm:px-8 lg:py-8 [@media(max-height:700px)]:py-4">
        <motion.div initial={reduceMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="w-full max-w-[460px]">
        <Card className="!rounded-3xl !border-white/80 shadow-[0_24px_70px_rgba(15,74,15,0.12)]" styles={{ body: { padding: 'clamp(20px, 5vw, 36px)' } }}>
          {/* Logo mobile */}
          <div className="lg:hidden flex justify-center mb-8">
            <BrandMark size={56} variant="compact" alt="Logo CEM" />
          </div>

          <Typography.Title level={2} className="!mb-1 !text-[#0F4A0F]">Connexion</Typography.Title>
          <Typography.Text type="secondary">Accédez à votre espace SGM-CEM</Typography.Text>

          {/* Tabs */}
          <Tabs activeKey={tab} centered className="my-5" onChange={key => { setTab(key as 'email' | 'phone'); setApiError('') }} items={[
            { key: 'email', label: <span className="flex items-center gap-2"><Mail size={15} /> Email</span> },
            { key: 'phone', label: <span className="flex items-center gap-2"><Phone size={15} /> Téléphone</span> },
          ]} />

          {/* ── Email + password ── */}
          {tab === 'email' && (
            <Form component="form" layout="vertical" onFinish={handleSubmit(onEmailSubmit)} className="space-y-1">
              <Form.Item
                label="Adresse email"
                validateStatus={errors.email ? 'error' : undefined}
                help={errors.email?.message}
              >
                <Controller
                  name="email"
                  control={control}
                  render={({ field }) => (
                    <Input {...field} type="email" placeholder="admin@cem-melen.cm" size="large" prefix={<Mail size={16} />} autoComplete="email"
                      suppressHydrationWarning
                    />
                  )}
                />
              </Form.Item>
              <Form.Item
                label="Mot de passe"
                validateStatus={errors.password ? 'error' : undefined}
                help={errors.password?.message}
              >
                <Controller
                  name="password"
                  control={control}
                  render={({ field }) => (
                    <Input.Password {...field} placeholder="••••••••" size="large" prefix={<Lock size={16} />} autoComplete="current-password"
                      visibilityToggle={{ visible: showPwd, onVisibleChange: setShowPwd }}
                      suppressHydrationWarning
                    />
                  )}
                />
              </Form.Item>
                <div className="flex justify-end mt-1.5">
                  <button type="button" onClick={openForgotModal} suppressHydrationWarning
                    className="text-xs text-[#1A6B1A] hover:underline">
                    Mot de passe oublié ?
                  </button>
                </div>
              {apiError && <ErrorBox message={apiError} />}
              <Button type="primary" htmlType="submit" size="large" block loading={isSubmitting} disabled={isSubmitting}
                className="!h-12 !bg-[#1A6B1A] !font-semibold">
                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
                {isSubmitting ? 'Connexion…' : 'Se connecter'}
              </Button>
            </Form>
          )}

          {/* ── Téléphone + OTP ── */}
          {tab === 'phone' && !otpSent && (
            <Form component="div" layout="vertical" className="space-y-4">
              <Form.Item
                label="Numéro de téléphone"
                validateStatus={phoneErr ? 'error' : undefined}
                help={phoneErr || 'Le numéro doit être enregistré dans votre compte.'}
              >
                <div className="flex gap-2">
                  <span className="flex items-center px-3 py-3 bg-gray-100 border border-gray-200 rounded-[10px] text-sm text-gray-600 shrink-0 font-mono">🇨🇲 +237</span>
                  <Input value={phone} onChange={e => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 9)); setPhoneErr('') }}
                    placeholder="6XXXXXXXX" suppressHydrationWarning
                    aria-label="Numéro de téléphone" inputMode="numeric" size="large" className="font-mono" />
                </div>
              </Form.Item>
              {apiError && <ErrorBox message={apiError} />}
              <Button type="primary" size="large" block onClick={sendOtp} loading={sendingOtp} disabled={sendingOtp || phone.length < 9}
                className="!h-12 !bg-[#1A6B1A] !font-semibold">
                {sendingOtp ? <Loader2 size={16} className="animate-spin" /> : <Phone size={16} />}
                {sendingOtp ? 'Envoi du code…' : 'Recevoir le code SMS/WhatsApp'}
              </Button>
            </Form>
          )}

          {tab === 'phone' && otpSent && (
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-1">Code envoyé au <strong>+237 {phone}</strong></p>
                <button onClick={() => { setOtpSent(false); setOtp('') }}
                  className="text-xs text-[#1A6B1A] hover:underline flex items-center gap-1 mx-auto">
                  <ArrowLeft size={11} /> Changer le numéro
                </button>
              </div>
              <Form component="div" layout="vertical">
                <Form.Item label="Code à 6 chiffres" className="!mb-0">
                <OtpInput value={otp} onChange={setOtp} disabled={verifyingOtp} />
                </Form.Item>
              </Form>
              {apiError && <ErrorBox message={apiError} />}
              <Button type="primary" size="large" block onClick={verifyOtp} loading={verifyingOtp} disabled={otp.length < 6 || verifyingOtp}
                className="!h-12 !bg-[#1A6B1A] !font-semibold">
                {verifyingOtp ? <Loader2 size={16} className="animate-spin" /> : null}
                {verifyingOtp ? 'Vérification…' : 'Valider le code'}
              </Button>
              <div className="text-center">
                {countdown > 0
                  ? <p className="text-xs text-gray-400">Renvoyer dans {countdown}s</p>
                  : <button onClick={sendOtp} disabled={sendingOtp} className="text-xs text-[#1A6B1A] hover:underline flex items-center gap-1 mx-auto">
                      <RefreshCw size={11} /> Renvoyer le code
                    </button>
                }
              </div>
            </div>
          )}

          {/* ── Séparateur Google ── */}
          <div className="flex items-center gap-3 mt-6 mb-4">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 font-medium">ou continuer avec</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* ── Bouton Google ── */}
          {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ? (
            <div>
              <div className="relative">
                <div
                  ref={googleBtnRef}
                  className={cn('w-full flex justify-center', (!googleBtnReady || googleLoading) && 'invisible')}
                />
                {(!googleBtnReady || googleLoading) && (
                  <div className="absolute inset-0 w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 rounded-[10px] text-sm text-gray-500 bg-white">
                    <Loader2 size={14} className="animate-spin" />
                    {googleLoading ? 'Connexion Google…' : 'Chargement Google…'}
                  </div>
                )}
              </div>
              {apiError && apiError.includes('Google') && (
                <div className="mt-2 rounded-[10px] bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
                  <p className="font-semibold mb-1 flex items-center gap-1.5">
                    <AlertCircle size={12} /> {apiError.includes('Aucun compte') ? 'Email Google non reconnu' : 'Connexion Google impossible'}
                  </p>
                  <p>{apiError}</p>
                </div>
              )}
            </div>
          ) : (
            <button type="button"
              className="w-full flex items-center justify-center gap-3 py-2.5 border-2 border-gray-200 rounded-[10px] text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.9 2.4 30.3 0 24 0 14.8 0 6.8 5.3 2.9 13l8 6.2C12.9 13 18 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.5 24.5c0-1.5-.1-3-.4-4.5H24v8.5h12.7c-.6 2.9-2.3 5.4-4.9 7l7.6 5.9C43.4 37.1 46.5 31.3 46.5 24.5z"/>
                <path fill="#FBBC05" d="M10.9 28.8c-.6-1.7-.9-3.5-.9-5.3s.3-3.6.9-5.3l-8-6.2C1.1 15.4 0 19.3 0 23.5s1.1 8.1 2.9 11.5l8-6.2z"/>
                <path fill="#34A853" d="M24 47c6.3 0 11.6-2.1 15.4-5.6l-7.6-5.9c-2.1 1.4-4.8 2.2-7.8 2.2-6 0-11.1-3.6-13.1-8.7l-8 6.2C6.8 42.7 14.8 47 24 47z"/>
              </svg>
              Continuer avec Google (non configuré)
            </button>
          )}

          <p className="text-center text-xs text-gray-400 mt-6">SGM-CEM · Culte d&apos;Enfants de Melen · EEC Yaoundé</p>
        </Card>
        </motion.div>
      </section>

      {/* ── Modal mot de passe oublié ── */}
      <Modal
        open={forgotOpen}
        onCancel={() => setForgotOpen(false)}
        title="Mot de passe oublié"
        footer={null}
        width={440}
      >
        <Typography.Paragraph type="secondary">Indiquez votre adresse email pour connaître la marche à suivre.</Typography.Paragraph>
        {!forgotResult ? (
          <form onSubmit={submitForgotPassword} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1.5">Adresse email</label>
              <Input
                type="email" required value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                placeholder="vous@exemple.com"
                size="large"
              />
            </div>
            {forgotError && <ErrorBox message={forgotError} />}
            <button type="submit" disabled={forgotLoading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-[#1A6B1A] text-white font-semibold rounded-[10px] shadow-cem hover:bg-[#0F4A0F] active:scale-[0.98] transition-all disabled:opacity-60">
              {forgotLoading ? <Loader2 size={16} className="animate-spin" /> : <HelpCircle size={16} />}
              {forgotLoading ? 'Vérification…' : 'Continuer'}
            </button>
          </form>
        ) : forgotResult.method === 'google' ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-[#E8F5E8] border border-[#1A6B1A]/20 rounded-[12px] p-4">
              <ShieldCheck size={18} className="text-[#1A6B1A] shrink-0 mt-0.5" />
              <p className="text-sm text-[#0F4A0F] leading-relaxed">{forgotResult.message}</p>
            </div>
            <button type="button" onClick={() => setForgotOpen(false)}
              className="w-full py-3 border-2 border-gray-200 text-gray-700 font-semibold rounded-[10px] hover:bg-gray-50 transition-colors">
              Compris
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-[12px] p-4">
              <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800 leading-relaxed">{forgotResult.message}</p>
            </div>
            {forgotResult.admin && (
              <div className="bg-gray-50 rounded-[12px] p-4 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Administrateur</p>
                <p className="text-sm font-semibold text-gray-800">{forgotResult.admin.fullName}</p>
                <a href={`mailto:${forgotResult.admin.email}`}
                  className="flex items-center gap-2 text-sm text-[#1A6B1A] hover:underline">
                  <Mail size={14} /> {forgotResult.admin.email}
                </a>
                {forgotResult.admin.phone && (
                  <a href={`tel:${forgotResult.admin.phone}`}
                    className="flex items-center gap-2 text-sm text-[#1A6B1A] hover:underline">
                    <MessageCircle size={14} /> {forgotResult.admin.phone}
                  </a>
                )}
              </div>
            )}
            <button type="button" onClick={() => setForgotOpen(false)}
              className="w-full py-3 border-2 border-gray-200 text-gray-700 font-semibold rounded-[10px] hover:bg-gray-50 transition-colors">
              Compris
            </button>
          </div>
        )}
      </Modal>
    </main>
  )
}

function ErrorBox({ message }: { message: string }) {
  return <Alert type="error" showIcon message={message} role="alert" />
}
