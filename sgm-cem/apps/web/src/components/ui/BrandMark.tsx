import Image from 'next/image'
import { cn } from '@/lib/utils'

type BrandMarkVariant = 'compact' | 'default' | 'inverse'
type BrandMarkSize = 40 | 48 | 56

interface BrandMarkProps {
  className?: string
  size?: BrandMarkSize
  variant?: BrandMarkVariant
  label?: string
  alt?: string
  decorative?: boolean
}

const VARIANTS: Record<BrandMarkVariant, string> = {
  compact: 'p-1.5 bg-white border border-gray-100 shadow-sm',
  default: 'gap-3 p-2 bg-white border border-gray-100 shadow-[0_6px_20px_rgba(5,32,5,0.08)]',
  inverse: 'gap-3 p-2 bg-white/10 border border-white/15 shadow-[0_6px_20px_rgba(0,0,0,0.16)]',
}

export function BrandMark({
  className,
  size = 48,
  variant = 'default',
  label,
  alt = 'SGM-CEM',
  decorative = false,
}: BrandMarkProps) {
  const accessibleAlt = decorative ? '' : alt

  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center rounded-full',
        VARIANTS[variant],
        className
      )}
    >
      <Image
        src="/icon-192.png"
        width={size}
        height={size}
        alt={accessibleAlt}
        aria-hidden={decorative || undefined}
        className="shrink-0 rounded-full object-cover"
      />
      {label && variant !== 'compact' ? (
        <span
          className={cn(
            'pr-2 font-display text-sm font-semibold leading-tight',
            variant === 'inverse' ? 'text-white' : 'text-[#0F4A0F]'
          )}
        >
          {label}
        </span>
      ) : null}
    </span>
  )
}
