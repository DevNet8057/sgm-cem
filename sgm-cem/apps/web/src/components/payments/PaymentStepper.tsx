'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button as AntButton, Form, Input, Modal, Progress, Result, Steps } from 'antd'
import { motion, useReducedMotion } from 'framer-motion'
import {
  AlertCircle, Check, CheckCircle2, CreditCard, ExternalLink,
  FileText, Heart, Loader2, Printer, RefreshCw, Share2, X,
} from 'lucide-react'
import api from '@/lib/api'
import { cn, formatAmount, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { calculateAmountWithCommission, YELII_COMMISSION_RATE } from '@sgm-cem/shared'
import { PaymentMethodSelector, OperatorSelector, type PayMode, type MobileOperator } from './PaymentMethodSelector'
import { PendingScreen, USSD_TIMEOUT } from './PendingScreen'
import type { Membre, Rubrique } from '@/types'

type PayStatus = 'idle' | 'submitting' | 'waiting' | 'redirected' | 'confirmed' | 'failed' | 'timeout'

type MembreWithCouple = Membre & {
  couple?: { id: string; user: { fullName: string } }
  nomConjoint?: string
}

export interface PaymentStepperProps {
  membres: Membre[]
  rubriques: Rubrique[]
  onClose: () => void
  onSuccess: () => void
}

const STEPS = ['Sélection', 'Mode', 'Récapitulatif', 'Résultat']

export function PaymentStepper({ membres, rubriques, onClose, onSuccess }: PaymentStepperProps) {
  const queryClient = useQueryClient()
  const reduceMotion = useReducedMotion()

  // Taux de commission EFFECTIF servi par l'API (panneau développeur —
  // clé YELII_COMMISSION_RATE en base). Le taux compilé n'est qu'un fallback :
  // il peut être périmé si le développeur l'a changé sans redéploiement.
  const { data: paymentConfig } = useQuery({
    queryKey: ['payments-config'],
    queryFn: async () => (await api.get('/payments/config')).data.data as { yeliiCommissionRate: number },
    staleTime: 60_000,
  })
  const commissionRate = paymentConfig?.yeliiCommissionRate ?? YELII_COMMISSION_RATE

  // Navigation
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')

  // Étape 1 — Sélection
  const [membreId, setMembreId] = useState('')
  const [rubriqueId, setRubriqueId] = useState('')
  const [montant, setMontant] = useState('')

  // Étape 2 — Mode de paiement
  const [mode, setMode] = useState<PayMode>('ESPECES')
  const [operator, setOperator] = useState<MobileOperator>('MTN')
  const [mobilePhone, setMobilePhone] = useState('')

  // Étape 4 — Résultat
  const [payStatus, setPayStatus] = useState<PayStatus>('idle')
  const [contribId, setContribId] = useState<string | null>(null)
  const [cinetpayUrl, setCinetpayUrl] = useState<string | null>(null)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [failReason, setFailReason] = useState('')
  const [countdown, setCountdown] = useState(USSD_TIMEOUT)

  // ── Données dérivées ──────────────────────────────────────────────────────
  const membreOptions = useMemo(
    () => membres.map(m => ({ value: m.id, label: m.user.fullName, sublabel: `${m.memberId} · ${m.profilFinancier}` })),
    [membres]
  )
  const rubriqueOptions = useMemo(
    () => rubriques.filter(r => r.status === 'OUVERTE').map(r => ({ value: r.id, label: r.title, sublabel: r.code })),
    [rubriques]
  )

  const selectedMembre   = membres.find(m => m.id === membreId) as MembreWithCouple | undefined
  const selectedRubrique = rubriques.find(r => r.id === rubriqueId)
  const isCouple         = selectedMembre?.profilFinancier === 'COUPLE'
  const hasCouple        = isCouple && !!selectedMembre?.couple

  const expectedAmount = useMemo(() => {
    if (!selectedMembre || !selectedRubrique) return undefined
    if (selectedMembre.profilFinancier === 'ETUDIANT') return selectedRubrique.amountEtudiant
    if (selectedMembre.profilFinancier === 'COUPLE')   return selectedRubrique.amountCouple
    return selectedRubrique.amountTravailleur
  }, [selectedMembre, selectedRubrique])

  const splitAmount = expectedAmount != null && isCouple ? Math.round(expectedAmount / 2) : null
  const isMobileMoney = mode === 'MOBILE_MONEY'

  // §1bis — détail transparent de la commission Mobile Money (source unique @sgm-cem/shared).
  // Le contributeur paie le montant majoré ; le montant dû à la rubrique reste `montant`.
  const mmBreakdown = useMemo(
    () => (isMobileMoney && Number(montant) > 0 ? calculateAmountWithCommission(Number(montant), commissionRate) : null),
    [isMobileMoney, montant, commissionRate]
  )

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

  // ── Polling du statut (Mobile Money + CinetPay) ───────────────────────────
  const poll = useCallback(async (): Promise<boolean> => {
    if (!contribId) return false
    try {
      const res = await api.get(`/payments/status/${contribId}`)
      const { statut, paymentStatus: ps, receiptUrl: rUrl } = res.data.data

      if (statut === 'CONFIRME' || ps === 'SUCCESS') {
        setPayStatus('confirmed')
        if (rUrl) setReceiptUrl(rUrl)
        await queryClient.invalidateQueries({ queryKey: ['contributions'] })
        await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
        setTimeout(onSuccess, 2500)
        return true
      }
      if (statut === 'ANNULE' || ps === 'FAILED') {
        setPayStatus('failed')
        return true
      }
    } catch { /* le webhook mettra à jour */ }
    return false
  }, [contribId, queryClient, onSuccess])

  useEffect(() => {
    if ((payStatus !== 'waiting' && payStatus !== 'redirected') || !contribId) return
    const iv = setInterval(async () => {
      const done = await poll()
      if (done) clearInterval(iv)
    }, 5000)
    return () => clearInterval(iv)
  }, [payStatus, contribId, poll])

  // ── Mutation : initier le paiement ───────────────────────────────────────
  const pay = useMutation({
    mutationFn: () =>
      api.post('/payments/initiate', {
        membreId,
        rubriqueId,
        montant: Number(montant),
        modePaiement: isMobileMoney ? 'YELII' : mode,
        mobileMoneyPhone: isMobileMoney ? mobilePhone : undefined,
        paymentChannel: isMobileMoney ? operator : undefined,
      }),
    onSuccess: async (res) => {
      // Le backend renvoie HTTP 200 avec { success:false, error } quand
      // l'initiation échoue (Yelii injoignable, solde insuffisant, etc.).
      // Sans ce garde-fou, l'accès à res.data.data (undefined) planterait
      // et l'utilisateur resterait bloqué sur le récapitulatif sans message.
      if (!res.data?.success) {
        const err = res.data?.error
        setFailReason(typeof err === 'string' ? err : (err?.message ?? ''))
        setStep(3)
        setPayStatus('failed')
        return
      }

      const d = res.data.data
      const id = d.contributionId ?? d.id
      setContribId(id)

      await queryClient.invalidateQueries({ queryKey: ['contributions'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      await queryClient.invalidateQueries({ queryKey: ['monthly-stats'] })
      await queryClient.invalidateQueries({ queryKey: ['rubriques'] })

      // Avancer à l'étape Résultat
      setStep(3)

      if (isMobileMoney && (d.status === 'PROCESSING' || d.paymentStatus === 'PROCESSING')) {
        setPayStatus('waiting')
      } else if (mode === 'CARTE_VISA' && d.paymentUrl) {
        setCinetpayUrl(d.paymentUrl)
        window.open(d.paymentUrl, '_blank', 'noopener,noreferrer')
        setPayStatus('redirected')
      } else if (d.status === 'SUCCESS' || d.paymentStatus === 'SUCCESS') {
        setPayStatus('confirmed')
        // Pas de fermeture automatique : l'utilisateur consulte le reçu
        // (Partager / Imprimer) puis ferme lui-même.
        // Récupérer l'URL du reçu généré (espèces : confirmation immédiate)
        api.get(`/payments/status/${id}`)
          .then(r => setReceiptUrl(r.data.data.receiptUrl ?? null))
          .catch(() => {})
      } else {
        setPayStatus('failed')
      }
    },
    onError: (err: unknown) => {
      // L'API renvoie parfois error sous forme de string, parfois { message }.
      const data = (err as { response?: { data?: { error?: unknown } } }).response?.data
      const raw = data?.error
      const msg = typeof raw === 'string' ? raw : (raw as { message?: string } | undefined)?.message
      setError(msg ?? 'Enregistrement impossible')
    },
  })

  // ── Navigation entre étapes ───────────────────────────────────────────────
  function goNext() {
    setError('')
    if (step === 0) {
      if (!membreId)  { setError('Sélectionnez un membre'); return }
      if (!rubriqueId){ setError('Sélectionnez une rubrique'); return }
      if (!montant || Number(montant) <= 0) { setError('Entrez un montant valide'); return }
    }
    if (step === 1 && isMobileMoney && !mobilePhone) {
      setError('Renseignez le numéro Mobile Money du payeur')
      return
    }
    setStep(s => s + 1)
  }

  function goPrev() {
    setError('')
    if (step === 3) return // Résultat ne revient pas en arrière
    setStep(s => Math.max(0, s - 1))
  }

  function retry() {
    setPayStatus('idle')
    setContribId(null)
    setFailReason('')
    setStep(2) // Retour au récap pour re-confirmer
    setError('')
  }

  const canClose = payStatus === 'idle' || payStatus === 'confirmed' || payStatus === 'failed'

  // ── Rendu ─────────────────────────────────────────────────────────────────
  return (
    <Modal
      open
      title={null}
      footer={null}
      width={576}
      centered
      closable={false}
      keyboard={canClose}
      maskClosable={canClose}
      onCancel={canClose ? onClose : undefined}
      styles={{ container: { padding: 0, overflow: 'hidden', borderRadius: 24 } }}
      modalRender={modal => (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.2, ease: 'easeOut' }}
        >
          {modal}
        </motion.div>
      )}
    >

        {/* ── En-tête ── */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">Enregistrer un paiement</h2>
            <p className="text-xs text-gray-400 mt-0.5">Étape {step + 1} sur {STEPS.length}</p>
          </div>
          <AntButton type="text" shape="circle" aria-label="Fermer" icon={<X size={16} />} disabled={!canClose} onClick={onClose} />
        </div>

        {/* ── Barre de progression ── */}
        <div className="border-b border-gray-50 px-4 py-4 sm:px-6">
          <Steps current={step} responsive={false} size="small" items={STEPS.map(title => ({ title }))} />
        </div>

        {/* ── Contenu des étapes ── */}
        <motion.div
          key={step}
          initial={reduceMotion ? false : { opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
          className="max-h-[62dvh] overflow-y-auto px-4 py-5 scrollbar-thin sm:px-6"
        >

          {/* ── Étape 1 : Sélection ── */}
          {step === 0 && (
            <Form layout="vertical" className="space-y-4">
              <div>
                <SearchableSelect
                  label="Membre"
                  required
                  placeholder="Rechercher par nom ou matricule…"
                  value={membreId}
                  onChange={setMembreId}
                  options={membreOptions}
                  emptyText="Aucun membre trouvé"
                />
                {selectedMembre && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center gap-2 rounded-[10px] bg-[#E8F5E8] border border-[#1A6B1A]/20 px-3 py-2">
                      <CheckCircle2 size={14} className="text-[#1A6B1A] shrink-0" />
                      <span className="text-sm font-semibold text-[#0F4A0F]">{selectedMembre.user.fullName}</span>
                      <span className="text-xs text-gray-500 ml-auto">{selectedMembre.profilFinancier}</span>
                    </div>
                    {isCouple && selectedMembre.couple && (
                      <div className="flex items-center gap-2 rounded-[10px] bg-pink-50 border border-pink-200 px-3 py-2">
                        <Heart size={13} className="text-pink-500 shrink-0" fill="currentColor" />
                        <span className="text-sm text-pink-700">Conjoint(e) : <strong>{selectedMembre.couple.user.fullName}</strong></span>
                      </div>
                    )}
                    {isCouple && selectedMembre.nomConjoint && !selectedMembre.couple && (
                      <div className="flex items-center gap-2 rounded-[10px] bg-pink-50 border border-pink-200 px-3 py-2">
                        <Heart size={13} className="text-pink-400 shrink-0" />
                        <span className="text-sm text-pink-600 italic">{selectedMembre.nomConjoint}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <SearchableSelect
                label="Rubrique"
                required
                placeholder="Rechercher une rubrique…"
                value={rubriqueId}
                onChange={rid => {
                  setRubriqueId(rid)
                  const r = rubriques.find(r => r.id === rid)
                  if (r && selectedMembre) {
                    const amt =
                      selectedMembre.profilFinancier === 'ETUDIANT' ? r.amountEtudiant :
                      selectedMembre.profilFinancier === 'COUPLE'   ? r.amountCouple   :
                      r.amountTravailleur
                    if (amt != null) setMontant(String(amt))
                  }
                }}
                options={rubriqueOptions}
                emptyText="Aucune rubrique ouverte"
              />

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">
                  Montant (FCFA) <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  value={montant}
                  onChange={e => setMontant(e.target.value)}
                  placeholder="0"
                />
                {expectedAmount != null && (
                  <p className="text-xs text-[#1A6B1A] mt-1">
                    Attendu : <strong>{formatAmount(expectedAmount)}</strong>
                  </p>
                )}
                {hasCouple && splitAmount != null && Number(montant) > 0 && (
                  <div className="mt-2 rounded-[8px] bg-pink-50 border border-pink-200 px-2.5 py-2 text-xs text-pink-700 space-y-0.5">
                    <p className="font-semibold flex items-center gap-1">
                      <Heart size={10} fill="currentColor" /> Split couple automatique :
                    </p>
                    <p>{selectedMembre?.user.fullName} → {formatAmount(Math.round(Number(montant) / 2))}</p>
                    <p>{selectedMembre?.couple?.user.fullName} → {formatAmount(Number(montant) - Math.round(Number(montant) / 2))}</p>
                  </div>
                )}
              </div>
            </Form>
          )}

          {/* ── Étape 2 : Mode de paiement ── */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">Choisissez le mode de règlement :</p>
              <PaymentMethodSelector value={mode} onChange={m => { setMode(m); setError('') }} />

              {/* Choix opérateur + numéro — Mobile Money uniquement */}
              {isMobileMoney && (
                <div className="rounded-[12px] bg-yellow-50 border border-yellow-200 p-3 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-yellow-800 mb-2">Choisissez votre opérateur</p>
                    <OperatorSelector value={operator} onChange={setOperator} />
                  </div>
                  <p className="text-xs font-semibold text-yellow-800 flex items-center gap-1.5">
                    <AlertCircle size={12} />
                    Numéro {operator === 'MTN' ? 'MTN MoMo' : 'Orange Money'} du payeur
                  </p>
                  <div className="flex gap-2">
                    <span className="flex items-center px-3 py-2 bg-white border border-yellow-300 rounded-[8px] text-sm text-gray-600 shrink-0 font-mono">🇨🇲 +237</span>
                    <Input
                      value={mobilePhone}
                      onChange={e => setMobilePhone(e.target.value.replace(/\D/g, '').slice(0, 9))}
                      placeholder="6XXXXXXXX"
                      inputMode="numeric"
                    />
                  </div>
                  <p className="text-[11px] text-yellow-700">
                    Une demande USSD sera envoyée sur ce numéro. Le payeur devra valider avec son code PIN.
                  </p>
                </div>
              )}

              {/* Info carte */}
              {mode === 'CARTE_VISA' && (
                <div className="rounded-[12px] bg-blue-50 border border-blue-200 p-3 space-y-1">
                  <p className="text-xs font-semibold text-blue-800 flex items-center gap-1.5">
                    <ExternalLink size={12} /> Paiement sécurisé CinetPay
                  </p>
                  <p className="text-[11px] text-blue-700">
                    Vous serez redirigé vers la page CinetPay pour saisir vos informations de carte. Les données bancaires ne transitent jamais par SGM-CEM (certifié PCI-DSS).
                  </p>
                </div>
              )}

              {/* Info espèces */}
              {mode === 'ESPECES' && (
                <div className="rounded-[12px] bg-[#E8F5E8] border border-[#1A6B1A]/20 p-3">
                  <p className="text-xs text-[#0F4A0F]">
                    La contribution sera enregistrée et confirmée immédiatement. Le reçu sera présenté à l&apos;écran — partage et impression possibles.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Étape 3 : Récapitulatif ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="rounded-[14px] bg-gray-50 border border-gray-200 p-4 space-y-2.5">
                <h3 className="font-display font-semibold text-[#0F4A0F] text-base mb-3">Récapitulatif</h3>
                <RecapRow label="Membre"   value={selectedMembre?.user.fullName ?? '—'} />
                <RecapRow label="Profil"   value={selectedMembre?.profilFinancier ?? '—'} />
                <RecapRow label="Rubrique" value={selectedRubrique ? `${selectedRubrique.code} — ${selectedRubrique.title}` : '—'} />
                <div className="border-t border-gray-200 pt-2.5">
                  <RecapRow label="Montant de la contribution" value={formatAmount(Number(montant))} highlight={!isMobileMoney} />
                </div>
                <RecapRow
                  label="Mode"
                  value={
                    isMobileMoney ? (operator === 'MTN' ? '🟡 MTN MoMo' : '🟠 Orange Money') :
                    mode === 'CARTE_VISA' ? '💳 Carte bancaire (CinetPay)' :
                    '💵 Espèces'
                  }
                />
                {mobilePhone && <RecapRow label="Tél. payeur" value={`+237 ${mobilePhone}`} />}
              </div>

              {/* §1bis — Détail Mobile Money : montant / frais / total, jamais caché */}
              {mmBreakdown && (
                <div className="rounded-[14px] bg-[#FFFBEB] border border-[#F5C400]/50 p-4 space-y-2">
                  <h4 className="text-xs font-bold text-[#8A6D00] uppercase tracking-wide mb-1">Détail du paiement Mobile Money</h4>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Montant de la contribution</span>
                    <span className="font-mono font-semibold text-gray-800">{formatAmount(mmBreakdown.dueAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Frais de transaction ({(commissionRate * 100).toLocaleString('fr-FR')}%)</span>
                    <span className="font-mono font-semibold text-gray-800">{formatAmount(mmBreakdown.commissionAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-[#F5C400]/50 pt-2">
                    <span className="font-semibold text-[#8A6D00]">Total à payer</span>
                    <span className="font-mono font-bold text-[#8A6D00] text-base">{formatAmount(mmBreakdown.totalToPay)}</span>
                  </div>
                  <p className="text-[11px] text-[#8A6D00]/80 pt-1">
                    ℹ Les frais de transaction Mobile Money sont à la charge du contributeur, conformément à la politique de l&apos;organisation.
                  </p>
                </div>
              )}

              {hasCouple && splitAmount != null && (
                <div className="rounded-[12px] bg-pink-50 border border-pink-200 p-3 space-y-2">
                  <p className="text-xs font-semibold text-pink-700 flex items-center gap-1.5">
                    <Heart size={11} fill="currentColor" /> Répartition couple (automatique)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-[8px] bg-white border border-pink-100 px-3 py-2 text-center">
                      <p className="text-[10px] text-gray-500 truncate">{selectedMembre?.user.fullName}</p>
                      <p className="font-mono font-bold text-sm text-[#1A6B1A]">{formatAmount(splitAmount)}</p>
                    </div>
                    <div className="rounded-[8px] bg-white border border-pink-100 px-3 py-2 text-center">
                      <p className="text-[10px] text-gray-500 truncate">{selectedMembre?.couple?.user.fullName}</p>
                      <p className="font-mono font-bold text-sm text-[#1A6B1A]">{formatAmount(Number(montant) - splitAmount)}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-2 rounded-[12px] bg-[#E8F5E8] border border-[#1A6B1A]/20 px-3 py-2.5 text-xs text-[#0F4A0F]">
                <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
                Un reçu PDF sera généré automatiquement après confirmation — vous pourrez le voir, le partager ou l&apos;imprimer.
              </div>
            </div>
          )}

          {/* ── Étape 4 : Résultat ── */}
          {step === 3 && (
            <div>
              {/* Initialisation — ne devrait pas durer */}
              {(payStatus === 'idle' || payStatus === 'submitting') && (
                <Result icon={<Loader2 size={32} className="mx-auto animate-spin text-[#1A6B1A]" />} title="Traitement en cours…" />
              )}

              {/* Mobile Money — attente USSD */}
              {payStatus === 'waiting' && (
                <div>
                  <PendingScreen
                    mode={operator === 'MTN' ? 'MTN_MOMO' : 'ORANGE_MONEY'}
                    phone={`+237 ${mobilePhone}`}
                    countdown={countdown}
                    amount={mmBreakdown ? formatAmount(mmBreakdown.totalToPay) : undefined}
                  />
                  <Progress percent={Math.round((countdown / USSD_TIMEOUT) * 100)} showInfo={false} strokeColor="#F5C400" />
                </div>
              )}

              {/* Timeout USSD */}
              {payStatus === 'timeout' && (
                <div className="py-6 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto">
                    <AlertCircle size={28} className="text-amber-500" />
                  </div>
                  <div>
                    <h3 className="font-display font-semibold text-amber-700 text-xl mb-1">Délai expiré</h3>
                    <p className="text-sm text-gray-500">
                      Si vous avez validé votre PIN, le paiement sera confirmé automatiquement dans votre historique.
                    </p>
                  </div>
                  <button onClick={retry} className="flex items-center gap-2 mx-auto text-sm text-[#1A6B1A] hover:underline">
                    <RefreshCw size={13} /> Réessayer
                  </button>
                </div>
              )}

              {/* CinetPay — redirigé */}
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

              {/* Paiement confirmé — le reçu est PRÉSENTÉ (pas envoyé automatiquement) */}
              {payStatus === 'confirmed' && (
                <div className="py-6 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-[#E8F5E8] flex items-center justify-center mx-auto">
                    <CheckCircle2 size={32} className="text-[#1A6B1A]" />
                  </div>
                  <div>
                    <h3 className="font-display font-semibold text-[#0F4A0F] text-xl mb-1">Paiement confirmé !</h3>
                    <p className="text-sm text-gray-500">
                      La contribution est enregistrée. Votre reçu est prêt ci-dessous.
                    </p>
                  </div>
                  {receiptUrl ? (
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <a
                        href={receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] bg-[#1A6B1A] text-white text-sm font-semibold hover:bg-[#0F4A0F] transition-colors"
                      >
                        <FileText size={14} /> Voir le reçu
                      </a>
                      <button
                        onClick={() => {
                          const w = window.open(receiptUrl, '_blank', 'noopener,noreferrer')
                          // PDF cross-origin : si print() est bloqué, le lecteur PDF
                          // du navigateur permet d'imprimer (Ctrl+P)
                          try { w?.addEventListener('load', () => { try { w.print() } catch { /* viewer */ } }) } catch { /* cross-origin */ }
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] border-2 border-[#1A6B1A] text-[#1A6B1A] text-sm font-semibold hover:bg-[#E8F5E8] transition-colors"
                      >
                        <Printer size={14} /> Imprimer
                      </button>
                      <button
                        onClick={async () => {
                          const text = 'Reçu de contribution — CEM Melen'
                          if (navigator.share) {
                            try { await navigator.share({ title: 'Reçu CEM Melen', text, url: receiptUrl }); return } catch { /* partage annulé */ }
                          }
                          // Fallback : partage WhatsApp choisi PAR l'utilisateur (pas automatique)
                          window.open(`https://wa.me/?text=${encodeURIComponent(`${text} : ${receiptUrl}`)}`, '_blank', 'noopener,noreferrer')
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] border-2 border-[#1A6B1A] text-[#1A6B1A] text-sm font-semibold hover:bg-[#E8F5E8] transition-colors"
                      >
                        <Share2 size={14} /> Partager
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                      <Loader2 size={12} className="animate-spin" /> Génération du reçu…
                    </div>
                  )}
                </div>
              )}

              {/* Paiement échoué */}
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

          {/* Erreur de validation */}
          {error && step < 3 && (
            <Alert className="mt-3" type="error" showIcon message={error} />
          )}
        </motion.div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          {/* Bouton gauche */}
          {step < 3 ? (
            <Button variant="ghost" onClick={step === 0 ? onClose : goPrev}>
              {step === 0 ? 'Annuler' : '← Retour'}
            </Button>
          ) : (
            <div />
          )}

          {/* Bouton droit */}
          {step === 0 && <Button onClick={goNext}>Suivant →</Button>}
          {step === 1 && <Button onClick={goNext}>Suivant →</Button>}
          {step === 2 && (
            <Button loading={pay.isPending} onClick={() => pay.mutate()}>
              <CreditCard size={14} />
              {mode === 'ESPECES' ? 'Confirmer le paiement' : 'Payer maintenant'}
            </Button>
          )}
          {step === 3 && (payStatus === 'confirmed' || payStatus === 'failed' || payStatus === 'timeout') && (
            <Button onClick={onClose}>Fermer</Button>
          )}
        </div>
    </Modal>
  )
}

function RecapRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm gap-4">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className={cn('font-semibold text-right', highlight ? 'font-mono text-[#1A6B1A] text-base' : 'text-gray-800')}>
        {value}
      </span>
    </div>
  )
}
