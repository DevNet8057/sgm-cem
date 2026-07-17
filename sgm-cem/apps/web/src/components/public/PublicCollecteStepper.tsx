'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle, Check, CheckCircle2, CreditCard, ExternalLink,
  FileText, Loader2, RefreshCw, Smartphone,
} from 'lucide-react'
import api from '@/lib/api'
import { cn, formatAmount } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { PendingScreen, USSD_TIMEOUT } from '@/components/payments/PendingScreen'
import { calculateAmountWithCommission, YELII_COMMISSION_RATE } from '@sgm-cem/shared'
import type { ChampPersonnalise, CollectePubliqueDef } from '@sgm-cem/shared'

type PayStatus = 'idle' | 'submitting' | 'waiting' | 'redirected' | 'confirmed' | 'failed' | 'timeout'
type ModePaiement = 'YELII' | 'CARTE_VISA'
type Channel = 'orange_money' | 'mtn_money'
type ValeursChamps = Record<string, string | boolean>

const STEPS = ['Vos informations', 'Montant', 'Paiement', 'Résultat']

export interface PublicCollecteStepperProps {
  collecte: CollectePubliqueDef
  slug: string
}

interface DraftPayload {
  nom?: string
  phone?: string
  email?: string
  montant?: number
  valeursChamps?: ValeursChamps
}

interface LocalDraft {
  token: string
  step: number
}

export function PublicCollecteStepper({ collecte, slug }: PublicCollecteStepperProps) {
  const queryClient = useQueryClient()
  const storageKey = `collecte-draft-${slug}`

  // Navigation
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')

  // Étape 1 — Informations
  const [nom, setNom] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [valeursChamps, setValeursChamps] = useState<ValeursChamps>({})

  // Étape 2 — Montant
  const [montant, setMontant] = useState('')

  // Étape 3 — Mode de paiement
  const [modePaiement, setModePaiement] = useState<ModePaiement>('YELII')
  const [channel, setChannel] = useState<Channel | ''>('')

  // Étape 4 — Résultat
  const [payStatus, setPayStatus] = useState<PayStatus>('idle')
  const [contribId, setContribId] = useState<string | null>(null)
  const [cinetpayUrl, setCinetpayUrl] = useState<string | null>(null)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [failReason, setFailReason] = useState('')
  const [countdown, setCountdown] = useState(USSD_TIMEOUT)

  // Brouillon (symptôme 3)
  const [touched, setTouched] = useState(false)
  const draftTokenRef = useRef<string | null>(null)
  const [resumeBanner, setResumeBanner] = useState<{ nom: string; phone: string; email: string; montant: string; valeursChamps: ValeursChamps; step: number } | null>(null)

  const isMobileMoney = modePaiement === 'YELII'
  const mmBreakdown = useMemo(
    () => (Number(montant) > 0 ? calculateAmountWithCommission(Number(montant), YELII_COMMISSION_RATE) : null),
    [montant]
  )

  // ── Persistance locale du brouillon ───────────────────────────────────────
  function readLocal(): LocalDraft | null {
    try {
      const raw = window.localStorage.getItem(storageKey)
      return raw ? (JSON.parse(raw) as LocalDraft) : null
    } catch { return null }
  }
  function saveLocal(token: string, currentStep: number) {
    try { window.localStorage.setItem(storageKey, JSON.stringify({ token, step: currentStep })) } catch { /* stockage indisponible */ }
  }
  function clearLocal() {
    try { window.localStorage.removeItem(storageKey) } catch { /* stockage indisponible */ }
  }

  // ── Reprise d'un brouillon existant au montage ────────────────────────────
  useEffect(() => {
    const local = readLocal()
    if (!local?.token) return
    ;(async () => {
      try {
        const res = await api.get('/public/drafts', { headers: { 'X-Draft-Token': local.token } })
        const d = res.data.data
        draftTokenRef.current = local.token
        setResumeBanner({
          nom: d.nom ?? '',
          phone: d.phone ?? '',
          email: d.email ?? '',
          montant: d.montant != null ? String(d.montant) : '',
          valeursChamps: d.valeursChamps ?? {},
          step: local.step ?? 0,
        })
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } }).response?.status
        if (status === 404) clearLocal() // brouillon expiré : purge silencieuse
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function acceptResume() {
    if (!resumeBanner) return
    setNom(resumeBanner.nom)
    setPhone(stripCountryCode(resumeBanner.phone))
    setEmail(resumeBanner.email)
    setMontant(resumeBanner.montant)
    setValeursChamps(resumeBanner.valeursChamps)
    setStep(resumeBanner.step)
    setTouched(true)
    setResumeBanner(null)
  }
  function dismissResume() {
    setResumeBanner(null)
  }

  // ── Sauvegarde automatique (création puis PATCH débouncés) ───────────────
  useEffect(() => {
    if (!touched) return
    const timer = setTimeout(async () => {
      const payload: DraftPayload = {
        nom: nom || undefined,
        phone: phone ? toE164(phone) : undefined,
        email: email || undefined,
        montant: montant ? Number(montant) : undefined,
        valeursChamps,
      }
      try {
        if (!draftTokenRef.current) {
          const res = await api.post(`/public/collectes/${slug}/drafts`, payload)
          const token = res.data.data.draftToken as string
          draftTokenRef.current = token
          saveLocal(token, step)
        } else {
          await api.patch('/public/drafts', { ...payload, etape: step }, { headers: { 'X-Draft-Token': draftTokenRef.current } })
          saveLocal(draftTokenRef.current, step)
        }
      } catch { /* brouillon = confort, jamais bloquant */ }
    }, 800)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touched, nom, phone, email, montant, valeursChamps, step])

  function markTouched() {
    if (!touched) setTouched(true)
  }

  // ── Countdown USSD (5 minutes) ────────────────────────────────────────────
  useEffect(() => {
    if (payStatus !== 'waiting') return
    setCountdown(USSD_TIMEOUT)
    const timer = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(timer)
          setPayStatus('timeout')
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [payStatus])

  // ── Polling du statut ─────────────────────────────────────────────────────
  const poll = useCallback(async (): Promise<boolean> => {
    if (!contribId || !draftTokenRef.current) return false
    try {
      const res = await api.get(`/public/payments/${contribId}/status`, { headers: { 'X-Draft-Token': draftTokenRef.current } })
      const { statut, paymentStatus: ps, receiptUrl: rUrl } = res.data.data

      if (statut === 'CONFIRME' || ps === 'SUCCESS') {
        setPayStatus('confirmed')
        if (rUrl) setReceiptUrl(rUrl)
        clearLocal()
        await queryClient.invalidateQueries({ queryKey: ['collecte-publique', slug] })
        return true
      }
      if (statut === 'ANNULE' || ps === 'FAILED') {
        setPayStatus('failed')
        return true
      }
    } catch { /* le webhook mettra à jour */ }
    return false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contribId, queryClient, slug])

  useEffect(() => {
    if ((payStatus !== 'waiting' && payStatus !== 'redirected') || !contribId) return
    const iv = setInterval(async () => {
      const done = await poll()
      if (done) clearInterval(iv)
    }, 5000)
    return () => clearInterval(iv)
  }, [payStatus, contribId, poll])

  // ── Mutation : initier le paiement ───────────────────────────────────────
  const initiate = useMutation({
    mutationFn: async () => {
      let token = draftTokenRef.current
      if (!token) {
        const res = await api.post(`/public/collectes/${slug}/drafts`, {
          nom: nom || undefined,
          phone: phone ? toE164(phone) : undefined,
          email: email || undefined,
          montant: montant ? Number(montant) : undefined,
          valeursChamps,
        })
        token = res.data.data.draftToken
        draftTokenRef.current = token
        if (token) saveLocal(token, step)
      }
      return api.post(
        `/public/collectes/${slug}/initiate`,
        {
          nom,
          phone: toE164(phone),
          email: email || undefined,
          montant: Number(montant),
          valeursChamps,
          modePaiement,
          channel: isMobileMoney ? channel : undefined,
        },
        { headers: { 'X-Draft-Token': token } }
      )
    },
    onSuccess: (res) => {
      // Même garde-fou que PaymentStepper : succès HTTP 200 avec success:false possible.
      if (!res.data?.success) {
        const err = res.data?.error
        setFailReason(typeof err === 'string' ? err : (err?.message ?? ''))
        setPayStatus('failed')
        return
      }

      const d = res.data.data
      setContribId(d.contributionId)

      if (isMobileMoney) {
        setPayStatus('waiting')
      } else if (modePaiement === 'CARTE_VISA' && d.paymentUrl) {
        setCinetpayUrl(d.paymentUrl)
        window.open(d.paymentUrl, '_blank', 'noopener,noreferrer')
        setPayStatus('redirected')
      } else {
        setPayStatus('failed')
      }
    },
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: { error?: unknown } } }).response?.data
      const raw = data?.error
      const msg = typeof raw === 'string' ? raw : (raw as { message?: string } | undefined)?.message
      setFailReason(msg ?? "La demande n'a pas abouti.")
      setPayStatus('failed')
    },
  })

  // ── Validation par étape ──────────────────────────────────────────────────
  function champLabel(champ: ChampPersonnalise): string {
    return champ.label + (champ.required ? ' *' : '')
  }

  function validateChamps(): string {
    for (const champ of collecte.champsPersonnalises) {
      if (!champ.required) continue
      const v = valeursChamps[champ.key]
      if (champ.type === 'checkbox' && v !== true) return `${champ.label} est obligatoire.`
      if (champ.type !== 'checkbox' && (v == null || String(v).trim() === '')) return `${champ.label} est obligatoire.`
    }
    return ''
  }

  function goNext() {
    setError('')
    if (step === 0) {
      if (!nom.trim()) { setError('Le nom complet est obligatoire'); return }
      if (phone.replace(/\D/g, '').length < 9) { setError('Entrez un numéro de téléphone valide'); return }
      const champErr = validateChamps()
      if (champErr) { setError(champErr); return }
    }
    if (step === 1) {
      const amount = Number(montant)
      if (!montant || amount <= 0) { setError('Entrez un montant valide'); return }
      if (collecte.montantMin != null && amount < collecte.montantMin) {
        setError(`Le montant minimum est de ${formatAmount(collecte.montantMin)}`)
        return
      }
    }
    setStep(s => s + 1)
  }

  function goPrev() {
    setError('')
    if (step === 3) return
    setStep(s => Math.max(0, s - 1))
  }

  function submitPayment() {
    setError('')
    if (isMobileMoney && !channel) { setError('Choisissez Orange Money ou MTN MoMo'); return }
    setPayStatus('submitting')
    setStep(3)
    initiate.mutate()
  }

  function retry() {
    setPayStatus('idle')
    setContribId(null)
    setFailReason('')
    setStep(2)
    setError('')
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F8FAF8] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-white rounded-[24px] shadow-sm border border-gray-100 overflow-hidden">

        {/* ── En-tête ── */}
        <div className="bg-gradient-to-br from-[#052005] to-[#1A6B1A] px-6 py-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-[#F5C400] flex items-center justify-center shrink-0">
            <span className="text-[#0F4A0F] font-black text-sm font-display">CEM</span>
          </div>
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm truncate">{collecte.titre}</p>
            <p className="text-white/60 text-xs">SGM-CEM · Collecte publique</p>
          </div>
        </div>

        {/* ── Bannière de reprise de brouillon ── */}
        {resumeBanner && (
          <div className="mx-4 mt-4 rounded-[12px] bg-amber-50 border border-amber-200 p-3 space-y-2">
            <p className="text-sm text-amber-800 font-semibold">Reprendre où vous vous étiez arrêté ?</p>
            <p className="text-xs text-amber-700">Une saisie précédente a été retrouvée pour cette collecte.</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={acceptResume}>Reprendre</Button>
              <Button size="sm" variant="ghost" onClick={dismissResume}>Recommencer</Button>
            </div>
          </div>
        )}

        {/* ── Barre de progression ── */}
        <div className="flex items-center gap-1 px-6 py-3 border-b border-gray-50">
          {STEPS.map((label, i) => (
            <div key={i} className="flex items-center gap-1.5 flex-1 min-w-0">
              <div className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-all',
                i < step ? 'bg-[#1A6B1A] text-white'
                : i === step ? 'bg-[#F5C400] text-[#0F4A0F]'
                : 'bg-gray-100 text-gray-400'
              )}>
                {i < step ? <Check size={10} /> : i + 1}
              </div>
              <span className={cn(
                'text-[10px] font-semibold truncate hidden sm:block',
                i === step ? 'text-[#0F4A0F]' : i < step ? 'text-[#1A6B1A]' : 'text-gray-400'
              )}>{label}</span>
              {i < STEPS.length - 1 && (
                <div className={cn('flex-1 h-0.5 rounded mx-0.5', i < step ? 'bg-[#1A6B1A]' : 'bg-gray-200')} />
              )}
            </div>
          ))}
        </div>

        {/* ── Contenu des étapes ── */}
        <div className="px-6 py-5 max-h-[65vh] overflow-y-auto scrollbar-thin">

          {/* ── Étape 1 : Vos informations ── */}
          {step === 0 && (
            <div className="space-y-4">
              {collecte.description && (
                <p className="text-sm text-gray-500">{collecte.description}</p>
              )}

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">
                  Nom complet <span className="text-red-500">*</span>
                </label>
                <input
                  value={nom}
                  onChange={e => { setNom(e.target.value); markTouched() }}
                  placeholder="Ex : Jean Mballa"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">
                  Téléphone <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <span className="flex items-center px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-[10px] text-sm text-gray-600 shrink-0 font-mono">🇨🇲 +237</span>
                  <input
                    value={phone}
                    onChange={e => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 9)); markTouched() }}
                    placeholder="6XXXXXXXX"
                    className="flex-1 px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">Email (optionnel)</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); markTouched() }}
                  placeholder="vous@exemple.com"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30"
                />
              </div>

              {collecte.champsPersonnalises.map(champ => (
                <div key={champ.key}>
                  {champ.type === 'checkbox' ? (
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={valeursChamps[champ.key] === true}
                        onChange={e => { setValeursChamps(v => ({ ...v, [champ.key]: e.target.checked })); markTouched() }}
                        className="w-4 h-4 rounded border-gray-300 text-[#1A6B1A] focus:ring-[#1A6B1A]/30"
                      />
                      <span className="text-sm text-gray-700">{champLabel(champ)}</span>
                    </label>
                  ) : (
                    <>
                      <label className="text-xs font-semibold text-gray-600 block mb-1.5">{champLabel(champ)}</label>
                      {champ.type === 'select' ? (
                        <select
                          value={typeof valeursChamps[champ.key] === 'string' ? (valeursChamps[champ.key] as string) : ''}
                          onChange={e => { setValeursChamps(v => ({ ...v, [champ.key]: e.target.value })); markTouched() }}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30"
                        >
                          <option value="">Sélectionnez…</option>
                          {(champ.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <input
                          type={champ.type === 'number' ? 'number' : champ.type === 'date' ? 'date' : 'text'}
                          value={typeof valeursChamps[champ.key] === 'string' ? (valeursChamps[champ.key] as string) : ''}
                          onChange={e => { setValeursChamps(v => ({ ...v, [champ.key]: e.target.value })); markTouched() }}
                          className="w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30"
                        />
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Étape 2 : Montant ── */}
          {step === 1 && (
            <div className="space-y-4">
              {collecte.montantsSuggeres.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">Montants suggérés</p>
                  <div className="grid grid-cols-3 gap-2">
                    {collecte.montantsSuggeres.map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => { setMontant(String(m)); markTouched() }}
                        className={cn(
                          'py-2.5 rounded-[10px] border-2 text-sm font-mono font-semibold transition-all',
                          Number(montant) === m ? 'border-[#1A6B1A] bg-[#E8F5E8] text-[#0F4A0F]' : 'border-gray-200 text-gray-700 hover:border-gray-300'
                        )}
                      >
                        {formatAmount(m)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">
                  Montant libre (FCFA) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={montant}
                  onChange={e => { setMontant(e.target.value); markTouched() }}
                  placeholder="0"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30"
                />
                {collecte.montantMin != null && (
                  <p className="text-xs text-gray-400 mt-1">Montant minimum : {formatAmount(collecte.montantMin)}</p>
                )}
              </div>

              {mmBreakdown && (
                <div className="rounded-[12px] bg-[#FFFBEB] border border-[#F5C400]/50 p-3">
                  <p className="text-xs text-[#8A6D00]">
                    Si vous payez par Mobile Money, vous paierez <strong>{formatAmount(mmBreakdown.totalToPay)}</strong> dont <strong>{formatAmount(mmBreakdown.commissionAmount)}</strong> de frais de transaction (à la charge du contributeur). Le paiement par carte bancaire n&apos;a pas de frais supplémentaires.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Étape 3 : Mode de paiement ── */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">Choisissez votre mode de paiement :</p>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => { setModePaiement('YELII'); setError('') }}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-[16px] border-2 p-4 transition-all text-center',
                    isMobileMoney ? 'border-[#F5C400] bg-[#FFFBEB] shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'
                  )}
                >
                  <Smartphone size={26} className="text-[#8A6D00]" />
                  <span className="text-sm font-semibold text-gray-800">Mobile Money</span>
                  <span className="text-[10px] text-gray-400">Orange / MTN</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setModePaiement('CARTE_VISA'); setError('') }}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-[16px] border-2 p-4 transition-all text-center',
                    modePaiement === 'CARTE_VISA' ? 'border-[#1A6B1A] bg-[#F0FDF4] shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'
                  )}
                >
                  <CreditCard size={26} className="text-[#1A6B1A]" />
                  <span className="text-sm font-semibold text-gray-800">Carte bancaire</span>
                  <span className="text-[10px] text-gray-400">Visa / Mastercard</span>
                </button>
              </div>

              {isMobileMoney && (
                <div className="rounded-[12px] bg-yellow-50 border border-yellow-200 p-3 space-y-2">
                  <p className="text-xs font-semibold text-yellow-800">Choisissez votre opérateur</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setChannel('mtn_money')}
                      className={cn(
                        'flex items-center gap-2 rounded-[12px] border-2 px-3 py-2.5 transition-all',
                        channel === 'mtn_money' ? 'border-[#FFD100] bg-[#FFFBEB]' : 'border-gray-200 hover:border-gray-300 bg-white'
                      )}
                    >
                      <span className="text-xl">🟡</span>
                      <span className="text-sm font-semibold text-gray-800 flex-1 text-left">MTN MoMo</span>
                      {channel === 'mtn_money' && (
                        <span className="w-4 h-4 rounded-full bg-[#FFD100] text-black flex items-center justify-center shrink-0"><Check size={9} /></span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setChannel('orange_money')}
                      className={cn(
                        'flex items-center gap-2 rounded-[12px] border-2 px-3 py-2.5 transition-all',
                        channel === 'orange_money' ? 'border-[#FF6600] bg-[#FFF7ED]' : 'border-gray-200 hover:border-gray-300 bg-white'
                      )}
                    >
                      <span className="text-xl">🟠</span>
                      <span className="text-sm font-semibold text-gray-800 flex-1 text-left">Orange Money</span>
                      {channel === 'orange_money' && (
                        <span className="w-4 h-4 rounded-full bg-[#FF6600] text-white flex items-center justify-center shrink-0"><Check size={9} /></span>
                      )}
                    </button>
                  </div>
                  <p className="text-[11px] text-yellow-700">
                    Une demande USSD sera envoyée au +237 {phone}. Validez avec votre code PIN.
                  </p>
                </div>
              )}

              {modePaiement === 'CARTE_VISA' && (
                <div className="rounded-[12px] bg-blue-50 border border-blue-200 p-3 space-y-1">
                  <p className="text-xs font-semibold text-blue-800 flex items-center gap-1.5">
                    <ExternalLink size={12} /> Paiement sécurisé CinetPay
                  </p>
                  <p className="text-[11px] text-blue-700">
                    Vous serez redirigé vers la page CinetPay pour saisir vos informations de carte. Les données bancaires ne transitent jamais par SGM-CEM.
                  </p>
                </div>
              )}

              <div className="rounded-[14px] bg-gray-50 border border-gray-200 p-4 space-y-1.5">
                <p className="text-xs text-gray-500">Montant de la contribution</p>
                <p className="font-mono font-bold text-lg text-[#1A6B1A]">{formatAmount(Number(montant))}</p>
              </div>
            </div>
          )}

          {/* ── Étape 4 : Résultat ── */}
          {step === 3 && (
            <div>
              {(payStatus === 'idle' || payStatus === 'submitting') && (
                <div className="py-10 text-center space-y-3">
                  <Loader2 size={32} className="animate-spin text-[#1A6B1A] mx-auto" />
                  <p className="text-sm text-gray-500">Traitement en cours…</p>
                </div>
              )}

              {payStatus === 'waiting' && (
                <PendingScreen
                  mode={channel === 'orange_money' ? 'ORANGE_MONEY' : 'MTN_MOMO'}
                  phone={`+237 ${phone}`}
                  countdown={countdown}
                  amount={mmBreakdown ? formatAmount(mmBreakdown.totalToPay) : undefined}
                />
              )}

              {payStatus === 'timeout' && (
                <div className="py-6 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto">
                    <AlertCircle size={28} className="text-amber-500" />
                  </div>
                  <div>
                    <h3 className="font-display font-semibold text-amber-700 text-xl mb-1">Délai expiré</h3>
                    <p className="text-sm text-gray-500">
                      Si vous avez validé votre PIN, le paiement sera confirmé automatiquement.
                    </p>
                  </div>
                  <button onClick={retry} className="flex items-center gap-2 mx-auto text-sm text-[#1A6B1A] hover:underline">
                    <RefreshCw size={13} /> Réessayer
                  </button>
                </div>
              )}

              {payStatus === 'redirected' && (
                <div className="py-6 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto">
                    <ExternalLink size={28} className="text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-display font-semibold text-[#0F4A0F] text-xl mb-1">Redirigé vers CinetPay</h3>
                    <p className="text-sm text-gray-500">
                      Finalisez votre paiement dans l&apos;onglet CinetPay.<br />
                      Cette page se mettra à jour automatiquement.
                    </p>
                  </div>
                  {cinetpayUrl && (
                    <button
                      onClick={() => window.open(cinetpayUrl, '_blank', 'noopener,noreferrer')}
                      className="flex items-center gap-2 mx-auto text-sm text-blue-600 hover:underline"
                    >
                      <ExternalLink size={13} /> Rouvrir CinetPay
                    </button>
                  )}
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
                    <Loader2 size={13} className="animate-spin" />
                    Vérification en cours…
                  </div>
                </div>
              )}

              {payStatus === 'confirmed' && (
                <div className="py-6 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-[#E8F5E8] flex items-center justify-center mx-auto">
                    <CheckCircle2 size={32} className="text-[#1A6B1A]" />
                  </div>
                  <div>
                    <h3 className="font-display font-semibold text-[#0F4A0F] text-xl mb-1">Paiement confirmé !</h3>
                    <p className="text-sm text-gray-500">
                      Merci pour votre générosité. Votre contribution a été enregistrée avec succès.
                    </p>
                  </div>
                  {receiptUrl ? (
                    <a
                      href={receiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[10px] bg-[#1A6B1A] text-white text-sm font-semibold hover:bg-[#0F4A0F] transition-colors"
                    >
                      <FileText size={14} /> Voir le reçu
                    </a>
                  ) : (
                    <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                      <Loader2 size={12} className="animate-spin" /> Génération du reçu…
                    </div>
                  )}
                </div>
              )}

              {payStatus === 'failed' && (
                <div className="py-6 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto">
                    <AlertCircle size={28} className="text-red-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-red-700 text-xl mb-1">Paiement échoué</h3>
                    <p className="text-sm text-gray-500">
                      {failReason || "La demande n'a pas abouti. Vérifiez votre solde ou essayez un autre mode."}
                    </p>
                  </div>
                  <button onClick={retry} className="flex items-center gap-2 mx-auto text-sm text-[#1A6B1A] hover:underline">
                    <RefreshCw size={13} /> Réessayer
                  </button>
                </div>
              )}
            </div>
          )}

          {error && step < 3 && (
            <div className="mt-3 flex items-center gap-2 rounded-[10px] bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={13} className="shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          {step > 0 && step < 3 ? (
            <Button variant="ghost" onClick={goPrev}>← Retour</Button>
          ) : <div />}

          {step === 0 && <Button onClick={goNext}>Suivant →</Button>}
          {step === 1 && <Button onClick={goNext}>Suivant →</Button>}
          {step === 2 && (
            <Button loading={payStatus === 'submitting'} onClick={submitPayment}>
              <CreditCard size={14} />
              Payer maintenant
            </Button>
          )}
        </div>

        <div className="px-6 pb-5 text-center">
          <p className="text-[10px] text-gray-400">
            SGM-CEM · Culte d&apos;Enfants de Melen · EEC Yaoundé
          </p>
        </div>
      </div>
    </div>
  )
}

/** Ajoute le préfixe pays si absent (saisie locale = 9 chiffres sans indicatif). */
function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('237') ? `+${digits}` : `+237${digits}`
}

/** Retire le préfixe +237 pour ré-afficher un numéro dans le champ de saisie local. */
function stripCountryCode(phone: string): string {
  return phone.replace(/^\+?237/, '').replace(/\D/g, '')
}
