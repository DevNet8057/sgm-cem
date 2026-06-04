import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'yellow' | 'outline' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg' | 'icon'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const V: Record<Variant, string> = {
  primary: 'bg-[#1A6B1A] text-white shadow-cem hover:bg-[#0F4A0F] hover:shadow-cem-lg focus:ring-[#1A6B1A]/30',
  yellow:  'bg-[#F5C400] text-[#0F4A0F] font-bold shadow-cem-yellow hover:bg-[#D4A800] focus:ring-[#F5C400]/40',
  outline: 'border-2 border-[#1A6B1A] text-[#1A6B1A] hover:bg-[#1A6B1A] hover:text-white focus:ring-[#1A6B1A]/30',
  ghost:   'text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:ring-gray-200',
  danger:  'bg-[#EF4444] text-white shadow-[0_4px_16px_rgba(239,68,68,0.3)] hover:bg-[#DC2626] focus:ring-red-300',
}
const S: Record<Size, string> = {
  sm:   'gap-1.5 px-3 py-1.5 text-xs rounded-[8px]',
  md:   'gap-2 px-5 py-2.5 text-sm rounded-[10px]',
  lg:   'gap-2 px-6 py-3 text-base rounded-[12px]',
  icon: 'w-9 h-9 rounded-[10px]',
}

export function Button({ variant = 'primary', size = 'md', loading, children, className, disabled, ...p }: ButtonProps) {
  return (
    <button
      {...p}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-semibold transition-all duration-200',
        'ease-[cubic-bezier(0.34,1.56,0.64,1)] active:scale-[0.97]',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
        'focus:outline-none focus:ring-2 focus:ring-offset-2',
        V[variant], S[size], className
      )}
    >
      {loading ? <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin" /> : null}
      {children}
    </button>
  )
}
