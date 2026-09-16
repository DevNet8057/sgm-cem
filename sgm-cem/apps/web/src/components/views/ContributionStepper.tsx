'use client'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Check, CheckCircle2, Clock, CreditCard, Heart, Loader2, X } from 'lucide-react'
import api from '@/lib/api'
import { cn, formatAmount, MODE_PAIEMENT_LABELS } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import type { Membre, ModePaiement, Rubrique } from '@/types'

type MembreWithCouple = Membre & {
  couple?: { id: string; user: { fullName: string } }
  nomConjoint?: string
}

interface StepperProps {
  membres: Membre[]
  rubriques: Rubrique[]
  onClose: () => void
  onSuccess: () => void
}

const STEPS = ['Sélection', 'Paiement', 'Confirmation']

export function ContributionStepper({ membres, rubriques, onClose, onSuccess }: StepperProps) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState(0)
  const [membreId, setMembreId] = useState('')
  const [rubriqueId, setRubriqueId] = useState('')
  const [montant, setMontant] = useState('')
  const [modePaiement, setModePaiement] = useState<ModePaiement>('ESPECES')
  const [mobilePhone, setMobilePhone] = useState('')
  const [mobileChannel, setMobileChannel] = useState<'MTN' | 'ORANGE'>('MTN')
  const [error, setError] = useState('')

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
  const hasLinkedCouple  = isCouple && !!selectedMembre?.couple

  const expectedAmount = useMemo(() => {
    if (!selectedMembre || !selectedRubrique) return undefined
    if (selectedMembre.profilFinancier === 'ETUDIANT') return selectedRubrique.amountEtudiant
    if (selectedMembre.profilFinancier === 'COUPLE')   return selectedRubrique.amountCouple
    return selectedRubrique.amountTravailleur
  }, [selectedMembre, selectedRubrique])

  // Montant split couple (50/50)
  const splitAmount = expectedAmount != null && isCouple ? Math.round(expectedAmount / 2) : null

  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'waiting' | 'confirmed' | 'failed'>('idle')
  const [createdContribId, setCreatedContribId] = useState<string | null>(null)

  // Polling du statut paiement mobile
  useEffect(() => {
    if (paymentStatus !== 'waiting' || !createdContribId) return
    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/payments/status/${createdContribId}`)
        const { statut, paymentStatus: ps } = res.data.data
        if (statut === 'CONFIRME' || ps === 'SUCCESS') {
          setPaymentStatus('confirmed')
          clearInterval(interval)
          await queryClient.invalidateQueries({ queryKey: ['contributions'] })
          await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
          setTimeout(onSuccess, 2000)
        } else if (statut === 'ANNULE' || ps === 'FAILED') {
          setPaymentStatus('failed')
          clearInterval(interval)
        }
      } catch { /* ignore */ }
    }, 5000)
    return () => clearInterval(interval)
  }, [paymentStatus, createdContribId, queryClient, onSuccess])

  const isMobileMoney = ['MTN_MOMO', 'ORANGE_MONEY'].includes(modePaiement as string)

  const create = useMutation({
    mutationFn: async () => {
      // Yelii handles both MTN and Orange Money
      const effectivePaymentMode = ['MTN_MOMO', 'ORANGE_MONEY'].includes(modePaiement) ? 'YELII' : modePaiement
      return api.post('/payments/initiate', {
        membreId,
        rubriqueId,
        montant: Number(montant),
        modePaiement: effectivePaymentMode,
        mobileMoneyPhone: mobilePhone || undefined,
        paymentChannel: mobileChannel,
      })
    },
    onSuccess: async (res) => {
      const contrib = res.data.data
      setCreatedContribId(contrib.contributionId ?? contrib.id)
      await queryClient.invalidateQueries({ queryKey: ['contributions'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      await queryClient.invalidateQueries({ queryKey: ['monthly-stats'] })
      await queryClient.invalidateQueries({ queryKey: ['rubriques'] })

      if (isMobileMoney && (contrib.status === 'PROCESSING' || contrib.paymentStatus === 'PROCESSING')) {
        setPaymentStatus('waiting')
      } else if (contrib.status === 'SUCCESS' || contrib.paymentStatus === 'SUCCESS') {
        onSuccess()
      }
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      setError(e.response?.data?.error?.message ?? 'Enregistrement impossible')
    },
  })

  function goNext() {
    setError('')
    if (step === 0) {
      if (!membreId) { setError('Sélectionnez un membre'); return }
      if (!rubriqueId) { setError('Sélectionnez une rubrique'); return }
      if (!montant || Number(montant) <= 0) { setError('Entrez un montant valide'); return }
    }
    if (step === 1) {
      if (isMobileMoney && !mobilePhone) {
        setError('Renseignez le numéro du payeur');
        return
      }
    }
    setStep(s => s + 1)
  }

  return (
    <div className="fixed inset-0 z-500 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white rounded-[24px] shadow-cem-xl animate-modal-in overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="font-display font-semibold text-[#0F4A0F] text-xl">Enregistrer un paiement</h2>
            <p className="text-xs text-gray-400 mt-0.5">Étape {step + 1} sur {STEPS.length}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-[8px] text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Progress stepper */}
        <div className="flex items-center gap-2 px-6 py-4 border-b border-gray-50">
          {STEPS.map((label, i) => (
            <div key={i} className="flex items-center gap-2 flex-1">
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all',
                i < step  ? 'bg-[#1A6B1A] text-white'   :
                i === step ? 'bg-[#F5C400] text-[#0F4A0F]' :
                             'bg-gray-100 text-gray-400'
              )}>
                {i < step ? <Check size={12} /> : i + 1}
              </div>
              <span className={cn(
                'text-[11px] font-semibold hidden sm:block',
                i === step ? 'text-[#0F4A0F]' : i < step ? 'text-[#1A6B1A]' : 'text-gray-400'
              )}>{label}</span>
              {i < STEPS.length - 1 && (
                <div className={cn('flex-1 h-0.5 rounded mx-1', i < step ? 'bg-[#1A6B1A]' : 'bg-gray-200')} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">

          {/* ── Step 0 : Bénéficiaire ── */}
          {step === 0 && (
            <div className="space-y-4">
              {/* Membre */}
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
                    {/* Afficher le couple lié */}
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

              {/* Rubrique */}
              <SearchableSelect
                label="Rubrique"
                required
                placeholder="Rechercher une rubrique…"
                value={rubriqueId}
                onChange={rid => {
                  setRubriqueId(rid)
                  const r = rubriques.find(r => r.id === rid)
                  if (r && selectedMembre) {
                    const amt = selectedMembre.profilFinancier === 'ETUDIANT' ? r.amountEtudiant
                      : selectedMembre.profilFinancier === 'COUPLE' ? r.amountCouple : r.amountTravailleur
                    if (amt != null) setMontant(String(amt))
                  }
                }}
                options={rubriqueOptions}
                emptyText="Aucune rubrique ouverte"
              />

              {/* Montant */}
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1.5">Montant (FCFA) <span className="text-red-500">*</span></label>
                <input type="number" value={montant} onChange={e => setMontant(e.target.value)} placeholder="0"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30" />
                {expectedAmount != null && (
                  <p className="text-xs text-[#1A6B1A] mt-1">Attendu : <strong>{formatAmount(expectedAmount)}</strong></p>
                )}
                {/* Split couple */}
                {hasLinkedCouple && splitAmount != null && Number(montant) > 0 && (
                  <div className="mt-2 rounded-[8px] bg-pink-50 border border-pink-200 px-2.5 py-2 text-xs text-pink-700 space-y-0.5">
                    <p className="font-semibold flex items-center gap-1"><Heart size={10} fill="currentColor" /> Split couple automatique :</p>
                    <p>{selectedMembre?.user.fullName} → {formatAmount(Math.round(Number(montant) / 2))}</p>
                    <p>{selectedMembre?.couple?.user.fullName} → {formatAmount(Number(montant) - Math.round(Number(montant) / 2))}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 1 : Mode de paiement ── */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500 mb-2">Choisissez le mode de règlement :</p>

              <div className="grid grid-cols-2 gap-3">
                {/* MTN MoMo */}
                <button
                  onClick={() => { setMobileChannel('MTN'); setModePaiement('MTN_MOMO') }}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-[16px] border-2 p-4 transition-all',
                    mobileChannel === 'MTN'
                      ? 'border-[#FFD100] shadow-cem bg-[#FFFBEB]'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  )}>
                  <span className="text-3xl">🟡</span>
                  <span className="text-sm font-semibold text-gray-800">MTN MoMo</span>
                  {mobileChannel === 'MTN' && (
                    <span className="w-5 h-5 rounded-full bg-[#FFD100] flex items-center justify-center">
                      <Check size={10} className="text-black" />
                    </span>
                  )}
                </button>

                {/* Orange Money */}
                <button
                  onClick={() => { setMobileChannel('ORANGE'); setModePaiement('ORANGE_MONEY') }}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-[16px] border-2 p-4 transition-all',
                    mobileChannel === 'ORANGE'
                      ? 'border-[#FF6600] shadow-cem bg-[#FFF7ED]'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  )}>
                  <span className="text-3xl">🟠</span>
                  <span className="text-sm font-semibold text-gray-800">Orange Money</span>
                  {mobileChannel === 'ORANGE' && (
                    <span className="w-5 h-5 rounded-full bg-[#FF6600] flex items-center justify-center">
                      <Check size={10} className="text-white" />
                    </span>
                  )}
                </button>

                {/* Carte */}
                <button
                  onClick={() => setModePaiement('CARTE_VISA')}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-[16px] border-2 p-4 transition-all',
                    modePaiement === 'CARTE_VISA'
                      ? 'border-[#1A6B1A] shadow-cem bg-[#F0FDF4]'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  )}>
                  <span className="text-3xl">💳</span>
                  <span className="text-sm font-semibold text-gray-800">Carte</span>
                  {modePaiement === 'CARTE_VISA' && (
                    <span className="w-5 h-5 rounded-full bg-[#1A6B1A] flex items-center justify-center">
                      <Check size={10} className="text-white" />
                    </span>
                  )}
                </button>

                {/* Espèces */}
                <button
                  onClick={() => setModePaiement('ESPECES')}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-[16px] border-2 p-4 transition-all',
                    modePaiement === 'ESPECES'
                      ? 'border-[#1A6B1A] shadow-cem bg-[#F0FDF4]'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  )}>
                  <span className="text-3xl">💵</span>
                  <span className="text-sm font-semibold text-gray-800">Espèces</span>
                  {modePaiement === 'ESPECES' && (
                    <span className="w-5 h-5 rounded-full bg-[#1A6B1A] flex items-center justify-center">
                      <Check size={10} className="text-white" />
                    </span>
                  )}
                </button>
              </div>

              {isMobileMoney && (
                <div className="rounded-[12px] bg-yellow-50 border border-yellow-200 p-3 space-y-2">
                  <p className="text-xs font-semibold text-yellow-800 flex items-center gap-1.5">
                    <AlertCircle size={13} /> Paiement Mobile Money via Yelii
                  </p>

                  <input
                    value={mobilePhone}
                    onChange={e => setMobilePhone(e.target.value)}
                    placeholder="Numéro du payeur (6XXXXXXXX)"
                    className="w-full px-3 py-2 border border-yellow-300 rounded-[8px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400/40" />
                  <p className="text-[11px] text-yellow-700">
                    Yelii va envoyer une demande USSD sur ce numéro. Le payeur devra entrer son code PIN pour confirmer.
                  </p>
                </div>
              )}

              {modePaiement === 'ESPECES' && (
                <div className="rounded-[12px] bg-gray-50 border border-gray-200 p-3">
                  <p className="text-xs text-gray-600">
                    Le collecteur devra confirmer la réception. Le membre recevra une notification WhatsApp.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2 : Récapitulatif ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="rounded-[14px] bg-gray-50 border border-gray-200 p-4 space-y-3">
                <h3 className="font-display font-semibold text-[#0F4A0F] text-lg mb-2">Récapitulatif</h3>
                <Row label="Membre" value={selectedMembre?.user.fullName ?? '—'} />
                <Row label="Profil" value={selectedMembre?.profilFinancier ?? '—'} />
                <Row label="Rubrique" value={selectedRubrique ? `${selectedRubrique.code} — ${selectedRubrique.title}` : '—'} />
                <Row label="Montant total" value={formatAmount(Number(montant))} highlight />
                <Row label="Mode" value={isMobileMoney ? `Paiement mobile - ${MODE_PAIEMENT_LABELS[modePaiement]}` : MODE_PAIEMENT_LABELS[modePaiement]} />
                {mobilePhone && <Row label="Tél. MoMo" value={mobilePhone} />}
              </div>

              {/* Aperçu split couple */}
              {hasLinkedCouple && splitAmount != null && (
                <div className="rounded-[12px] bg-pink-50 border border-pink-200 p-3 space-y-2">
                  <p className="text-xs font-semibold text-pink-700 flex items-center gap-1.5">
                    <Heart size={12} fill="currentColor" /> Répartition couple (automatique)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-[8px] bg-white border border-pink-100 px-3 py-2 text-center">
                      <p className="text-[11px] text-gray-500 truncate">{selectedMembre?.user.fullName}</p>
                      <p className="font-mono font-bold text-sm text-[#1A6B1A]">{formatAmount(splitAmount)}</p>
                    </div>
                    <div className="rounded-[8px] bg-white border border-pink-100 px-3 py-2 text-center">
                      <p className="text-[11px] text-gray-500 truncate">{selectedMembre?.couple?.user.fullName}</p>
                      <p className="font-mono font-bold text-sm text-[#1A6B1A]">{formatAmount(Number(montant) - splitAmount)}</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-pink-600">Le système créera une contribution séparée dans le compte de chaque conjoint pour les statistiques.</p>
                </div>
              )}

              <div className="flex items-start gap-2 rounded-[12px] bg-[#E8F5E8] border border-[#1A6B1A]/20 px-3 py-2.5 text-xs text-[#0F4A0F]">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                Un reçu PDF sera généré automatiquement après confirmation du paiement.
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-[10px] bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  <AlertCircle size={14} className="shrink-0" />
                  {error}
                </div>
              )}
            </div>
          )}

          {error && step < 2 && (
            <p className="mt-3 text-sm text-red-600 flex items-center gap-1.5">
              <AlertCircle size={13} /> {error}
            </p>
          )}
        </div>

        {/* ── Attente paiement mobile ── */}
        {paymentStatus === 'waiting' && (
          <div className="px-6 py-8 text-center border-t border-gray-100">
            <div className="w-16 h-16 rounded-full bg-yellow-50 flex items-center justify-center mx-auto mb-4 animate-pulse">
              <Clock size={28} className="text-yellow-600" />
            </div>
            <h3 className="font-display font-semibold text-[#0F4A0F] text-xl mb-2">Demande envoyée</h3>
            <p className="text-sm text-gray-500 mb-1">
              {modePaiement === 'YELII'
                ? 'Une collecte Yelii a été initiée sur'
                : `Une demande ${modePaiement === 'MTN_MOMO' ? 'MTN MoMo' : 'Orange Money'} a été envoyée sur`}
              <br />
              <strong>{mobilePhone}</strong>
            </p>
            <p className="text-xs text-gray-400 mb-4">Entrez votre code PIN sur votre téléphone pour valider le paiement.</p>
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
              <Loader2 size={14} className="animate-spin" />
              En attente de confirmation…
            </div>
          </div>
        )}

        {paymentStatus === 'confirmed' && (
          <div className="px-6 py-8 text-center border-t border-gray-100">
            <div className="w-16 h-16 rounded-full bg-[#E8F5E8] flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={28} className="text-[#1A6B1A]" />
            </div>
            <h3 className="font-display font-semibold text-[#0F4A0F] text-xl mb-2">Paiement confirmé !</h3>
            <p className="text-sm text-gray-500">Votre contribution a été enregistrée et confirmée automatiquement.</p>
          </div>
        )}

        {paymentStatus === 'failed' && (
          <div className="px-6 py-6 text-center border-t border-gray-100">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={28} className="text-red-500" />
            </div>
            <h3 className="font-semibold text-red-700 mb-2">Paiement refusé ou annulé</h3>
            <p className="text-sm text-gray-500 mb-4">La demande de paiement n'a pas abouti.</p>
            <Button variant="danger" onClick={onClose}>Fermer</Button>
          </div>
        )}

        {/* Footer */}
        {paymentStatus === 'idle' && (
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
            <Button variant="ghost" onClick={step === 0 ? onClose : () => setStep(s => s - 1)}>
              {step === 0 ? 'Annuler' : '← Retour'}
            </Button>
            {step < 2 ? (
              <Button onClick={goNext}>Suivant →</Button>
            ) : (
              <Button loading={create.isPending} onClick={() => create.mutate()}>
                <CreditCard size={14} />
                Confirmer & Enregistrer
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={cn('font-semibold', highlight ? 'font-mono text-[#1A6B1A] text-base' : 'text-gray-800')}>{value}</span>
    </div>
  )
}
