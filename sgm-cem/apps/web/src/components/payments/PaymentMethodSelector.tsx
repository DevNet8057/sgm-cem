'use client'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type PayMode = 'MOBILE_MONEY' | 'CARTE_VISA' | 'ESPECES'
export type MobileOperator = 'MTN' | 'ORANGE'

interface Props {
  value: PayMode
  onChange: (mode: PayMode) => void
}

const OPTIONS: Array<{
  id: PayMode
  emoji: string
  label: string
  sub?: string
  info: string
  border: string
  bg: string
  check: string
}> = [
  {
    id: 'MOBILE_MONEY',
    emoji: '📱',
    label: 'Mobile Money',
    sub: 'MTN MoMo / Orange Money',
    info: 'Valider sur votre téléphone',
    border: 'border-[#F5C400]',
    bg: 'bg-[#FFFBEB]',
    check: 'bg-[#F5C400] text-black',
  },
  {
    id: 'CARTE_VISA',
    emoji: '💳',
    label: 'Carte bancaire',
    sub: 'Visa / Mastercard',
    info: 'Redirigé vers CinetPay (sécurisé)',
    border: 'border-[#1A6B1A]',
    bg: 'bg-[#F0FDF4]',
    check: 'bg-[#1A6B1A] text-white',
  },
  {
    id: 'ESPECES',
    emoji: '💵',
    label: 'Espèces',
    info: 'Remis directement au collecteur',
    border: 'border-[#1A6B1A]',
    bg: 'bg-[#F0FDF4]',
    check: 'bg-[#1A6B1A] text-white',
  },
]

export function PaymentMethodSelector({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {OPTIONS.map(opt => {
        const selected = value === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-[16px] border-2 p-4 transition-all text-center',
              selected
                ? `${opt.border} ${opt.bg} shadow-sm`
                : 'border-gray-200 hover:border-gray-300 bg-white'
            )}
          >
            <span className="text-3xl">{opt.emoji}</span>
            <span className="text-sm font-semibold text-gray-800 leading-tight">{opt.label}</span>
            {opt.sub && <span className="text-[10px] text-gray-400">{opt.sub}</span>}
            <span className="text-[10px] text-gray-400 leading-tight">{opt.info}</span>
            {selected && (
              <span className={cn('w-5 h-5 rounded-full flex items-center justify-center mt-0.5', opt.check)}>
                <Check size={10} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

const OPERATORS: Array<{ id: MobileOperator; emoji: string; label: string; border: string; bg: string; check: string }> = [
  { id: 'MTN', emoji: '🟡', label: 'MTN MoMo', border: 'border-[#FFD100]', bg: 'bg-[#FFFBEB]', check: 'bg-[#FFD100] text-black' },
  { id: 'ORANGE', emoji: '🟠', label: 'Orange Money', border: 'border-[#FF6600]', bg: 'bg-[#FFF7ED]', check: 'bg-[#FF6600] text-white' },
]

interface OperatorProps {
  value: MobileOperator
  onChange: (op: MobileOperator) => void
}

export function OperatorSelector({ value, onChange }: OperatorProps) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {OPERATORS.map(op => {
        const selected = value === op.id
        return (
          <button
            key={op.id}
            type="button"
            onClick={() => onChange(op.id)}
            className={cn(
              'flex items-center gap-2 rounded-[12px] border-2 px-3 py-2.5 transition-all',
              selected ? `${op.border} ${op.bg}` : 'border-gray-200 hover:border-gray-300 bg-white'
            )}
          >
            <span className="text-xl">{op.emoji}</span>
            <span className="text-sm font-semibold text-gray-800 flex-1 text-left">{op.label}</span>
            {selected && (
              <span className={cn('w-4 h-4 rounded-full flex items-center justify-center shrink-0', op.check)}>
                <Check size={9} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
