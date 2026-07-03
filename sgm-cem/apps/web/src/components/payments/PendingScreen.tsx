'use client'
import { AlertCircle, Clock, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const USSD_TIMEOUT = 300

function formatCountdown(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

interface Props {
  mode: 'MTN_MOMO' | 'ORANGE_MONEY'
  phone: string
  countdown: number
  /** Montant majoré réellement débité sur le Mobile Money (total à payer, §1bis). */
  amount?: string
}

export { USSD_TIMEOUT, formatCountdown }

export function PendingScreen({ mode, phone, countdown, amount }: Props) {
  const networkName = mode === 'MTN_MOMO' ? 'MTN MoMo' : 'Orange Money'
  const pinLabel = mode === 'MTN_MOMO' ? 'MoMo' : 'Orange'
  const expired = countdown === 0

  return (
    <div className="py-6 space-y-4">
      <div className="text-center">
        <div className={cn(
          'w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4',
          expired ? 'bg-amber-50' : 'bg-yellow-50 animate-pulse'
        )}>
          {expired
            ? <AlertCircle size={28} className="text-amber-500" />
            : <Clock size={28} className="text-yellow-600" />
          }
        </div>
        <h3 className="font-display font-semibold text-[#0F4A0F] text-xl mb-1">
          {expired ? 'Délai expiré' : 'Demande envoyée'}
        </h3>
        {!expired && (
          <p className="text-sm text-gray-500">
            Une demande <strong>{networkName}</strong> a été envoyée sur <br />
            <strong className="text-gray-800">{phone}</strong>
          </p>
        )}
        {expired && (
          <p className="text-sm text-amber-700">
            Si vous avez validé votre PIN, la confirmation arrivera automatiquement.
          </p>
        )}
      </div>

      {!expired && (
        <div className="rounded-[12px] bg-yellow-50 border border-yellow-200 p-3 mx-2 space-y-1.5">
          <p className="text-xs font-semibold text-yellow-800">Sur votre téléphone :</p>
          <p className="text-xs text-yellow-700">① Attendez la notification USSD</p>
          <p className="text-xs text-yellow-700">② Entrez votre code PIN {pinLabel}</p>
          <p className="text-xs text-yellow-700">③ Validez le paiement{amount ? ` de ${amount}` : ' de la transaction'}</p>
        </div>
      )}

      <div className="flex items-center justify-between px-2 text-sm">
        {!expired ? (
          <>
            <div className="flex items-center gap-2 text-gray-500">
              <Loader2 size={14} className="animate-spin" />
              En attente de confirmation…
            </div>
            <span className={cn(
              'font-mono font-bold tabular-nums',
              countdown < 60 ? 'text-red-500' : 'text-gray-400'
            )}>
              {formatCountdown(countdown)}
            </span>
          </>
        ) : (
          <p className="text-xs text-amber-600 text-center w-full">
            Vérifiez votre historique de contributions dans quelques instants.
          </p>
        )}
      </div>
    </div>
  )
}
