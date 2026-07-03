'use client'
import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'

type Status = 'loading' | 'confirmed' | 'pending' | 'failed'

export default function PaymentReturnPage() {
  const params = useSearchParams()
  const router = useRouter()
  const transactionId = params.get('transaction_id') ?? params.get('cpm_trans_id')

  const [status, setStatus] = useState<Status>('loading')
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)

  useEffect(() => {
    if (!transactionId) {
      setStatus('failed')
      return
    }

    const MAX_ATTEMPTS = 12 // 12 × 5s = 60 secondes de polling
    let stopped = false

    async function check() {
      try {
        const res = await api.get(`/payments/status/${transactionId}`)
        const { statut, paymentStatus: ps, receiptUrl: rUrl } = res.data.data

        if (statut === 'CONFIRME' || ps === 'SUCCESS') {
          if (!stopped) {
            setStatus('confirmed')
            if (rUrl) setReceiptUrl(rUrl)
          }
          return true
        }
        if (statut === 'ANNULE' || ps === 'FAILED') {
          if (!stopped) setStatus('failed')
          return true
        }
      } catch { /* ignore */ }
      return false
    }

    async function poll() {
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        if (stopped) return
        setAttempts(i + 1)
        const done = await check()
        if (done) return
        await new Promise(r => setTimeout(r, 5000))
      }
      // Après 60 secondes sans résultat : afficher "en attente"
      if (!stopped) setStatus('pending')
    }

    poll()
    return () => { stopped = true }
  }, [transactionId])

  return (
    <div className="min-h-screen bg-[#F8FAF8] flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-[24px] shadow-sm border border-gray-100 overflow-hidden">
        {/* Logo */}
        <div className="bg-gradient-to-br from-[#052005] to-[#1A6B1A] px-6 py-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-[#F5C400] flex items-center justify-center">
            <span className="text-[#0F4A0F] font-black text-sm font-display">CEM</span>
          </div>
          <div>
            <p className="text-white font-semibold text-sm">SGM-CEM</p>
            <p className="text-white/60 text-xs">Retour de paiement CinetPay</p>
          </div>
        </div>

        <div className="p-6 text-center space-y-4">
          {/* Loading */}
          {status === 'loading' && (
            <>
              <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto animate-pulse">
                <Loader2 size={28} className="text-blue-500 animate-spin" />
              </div>
              <div>
                <h2 className="font-display font-semibold text-[#0F4A0F] text-xl mb-1">Vérification en cours</h2>
                <p className="text-sm text-gray-500">Confirmation du paiement… ({attempts}/12)</p>
              </div>
              <div className="rounded-[10px] bg-gray-50 border border-gray-100 p-3">
                <p className="text-xs text-gray-400 font-mono truncate">
                  {transactionId ?? 'ID inconnu'}
                </p>
              </div>
            </>
          )}

          {/* Confirmé */}
          {status === 'confirmed' && (
            <>
              <div className="w-16 h-16 rounded-full bg-[#E8F5E8] flex items-center justify-center mx-auto">
                <CheckCircle2 size={32} className="text-[#1A6B1A]" />
              </div>
              <div>
                <h2 className="font-display font-semibold text-[#0F4A0F] text-xl mb-1">Paiement confirmé !</h2>
                <p className="text-sm text-gray-500">Votre contribution a été enregistrée avec succès.</p>
              </div>
              {receiptUrl && (
                <a
                  href={receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[10px] bg-[#1A6B1A] text-white text-sm font-semibold hover:bg-[#0F4A0F] transition-colors"
                >
                  Télécharger le reçu PDF
                </a>
              )}
              <button
                onClick={() => router.push('/dashboard')}
                className="block w-full py-2.5 border-2 border-gray-200 text-gray-700 font-semibold rounded-[10px] hover:bg-gray-50 transition-colors text-sm"
              >
                Retour au tableau de bord
              </button>
            </>
          )}

          {/* En attente (timeout polling) */}
          {status === 'pending' && (
            <>
              <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto">
                <Loader2 size={28} className="text-amber-500" />
              </div>
              <div>
                <h2 className="font-display font-semibold text-amber-700 text-xl mb-1">Paiement en cours</h2>
                <p className="text-sm text-gray-500">
                  La confirmation n'est pas encore reçue. Vérifiez votre historique dans quelques instants.
                </p>
              </div>
              <button
                onClick={() => router.push('/dashboard')}
                className="w-full py-2.5 bg-[#1A6B1A] text-white font-semibold rounded-[10px] hover:bg-[#0F4A0F] transition-colors text-sm"
              >
                Voir mes contributions
              </button>
            </>
          )}

          {/* Échoué */}
          {status === 'failed' && (
            <>
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto">
                <AlertCircle size={28} className="text-red-500" />
              </div>
              <div>
                <h2 className={cn('font-semibold text-xl mb-1', !transactionId ? 'text-gray-700' : 'text-red-700')}>
                  {!transactionId ? 'Lien invalide' : 'Paiement non abouti'}
                </h2>
                <p className="text-sm text-gray-500">
                  {!transactionId
                    ? 'Aucun identifiant de transaction dans l\'URL.'
                    : 'Le paiement a été refusé ou annulé. Réessayez depuis l\'application.'}
                </p>
              </div>
              <button
                onClick={() => router.push('/dashboard')}
                className="w-full py-2.5 border-2 border-gray-200 text-gray-700 font-semibold rounded-[10px] hover:bg-gray-50 transition-colors text-sm"
              >
                Retour au tableau de bord
              </button>
            </>
          )}
        </div>

        <div className="px-6 pb-5 text-center">
          <p className="text-[10px] text-gray-400">
            SGM-CEM · Culte d'Enfants de Melen · EEC Yaoundé
          </p>
        </div>
      </div>
    </div>
  )
}
