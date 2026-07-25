import { Button as AntButton } from 'antd'
import type { ButtonProps as AntButtonProps } from 'antd'
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'yellow' | 'outline' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg' | 'icon'
type NativeButtonType = ButtonHTMLAttributes<HTMLButtonElement>['type']

interface ButtonProps extends Omit<
  AntButtonProps,
  'color' | 'danger' | 'href' | 'loading' | 'size' | 'type' | 'variant'
> {
  variant?: Variant
  size?: Size
  loading?: boolean
  type?: NativeButtonType
}

interface VariantConfig {
  antType: NonNullable<AntButtonProps['type']>
  danger?: boolean
  className: string
}

const VARIANTS: Record<Variant, VariantConfig> = {
  primary: {
    antType: 'primary',
    className: cn(
      '!border-transparent !bg-[linear-gradient(135deg,#2ECC71_0%,#22C55E_100%)] !text-[#07120D]',
      'shadow-[0_8px_30px_rgba(0,0,0,.25)] enabled:hover:shadow-[0_20px_40px_rgba(0,0,0,.35)]'
    ),
  },
  yellow: {
    antType: 'default',
    className: cn(
      '!border-transparent !bg-[#F5C400] !text-[#0F4A0F]',
      'shadow-cem-yellow enabled:hover:!border-transparent enabled:hover:!bg-[#D4A800]'
    ),
  },
  outline: {
    antType: 'default',
    className: cn(
      '!border-[var(--cem-border-strong)] !bg-transparent !text-[var(--cem-primary)]',
      'enabled:hover:!border-[var(--cem-primary)] enabled:hover:!bg-[var(--cem-primary-soft)]'
    ),
  },
  ghost: {
    antType: 'text',
    className: cn(
      '!border-transparent !bg-transparent !text-[var(--cem-text-muted)]',
      'enabled:hover:!bg-[var(--cem-surface-muted)] enabled:hover:!text-[var(--cem-text)]'
    ),
  },
  danger: {
    antType: 'primary',
    danger: true,
    className: cn(
      '!border-transparent !bg-[#EF4444] !text-white',
      'shadow-[0_8px_20px_rgba(239,68,68,0.24)] enabled:hover:!border-transparent enabled:hover:!bg-[#DC2626]'
    ),
  },
}

const ANT_SIZES: Record<Size, NonNullable<AntButtonProps['size']>> = {
  sm: 'small',
  md: 'middle',
  lg: 'large',
  icon: 'middle',
}

const SIZES: Record<Size, string> = {
  sm: '!h-9 !px-3 !text-xs',
  md: '!h-[46px] !px-5 !text-sm',
  lg: '!h-12 !px-6 !text-base',
  icon: '!size-[46px] !min-w-[46px] !p-0',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      children,
      className,
      disabled,
      htmlType,
      type,
      ...props
    },
    ref
  ) {
    const variantConfig = VARIANTS[variant]

    return (
      <AntButton
        {...props}
        ref={ref}
        type={variantConfig.antType}
        danger={variantConfig.danger}
        size={ANT_SIZES[size]}
        htmlType={htmlType ?? type ?? 'submit'}
        loading={loading}
        disabled={disabled || loading}
        className={cn(
          '!rounded-[14px] !font-semibold',
          'transition-[transform,box-shadow,background-color,border-color,color] duration-[250ms]',
          'ease-[cubic-bezier(0.34,1.56,0.64,1)]',
          'enabled:hover:-translate-y-0.5 enabled:hover:scale-[1.02]',
          'enabled:active:translate-y-0 enabled:active:scale-[0.98]',
          'disabled:!cursor-not-allowed disabled:!opacity-50 disabled:!transform-none',
          variantConfig.className,
          SIZES[size],
          className
        )}
      >
        {children}
      </AntButton>
    )
  }
)
