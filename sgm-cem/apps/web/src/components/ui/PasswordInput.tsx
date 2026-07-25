'use client'

import { ConfigProvider, Input as AntInput, Progress } from 'antd'
import type { InputRef, ThemeConfig } from 'antd'
import { Check, Eye, EyeOff, Minus } from 'lucide-react'
import {
  forwardRef,
  useCallback,
  useId,
  useState,
} from 'react'
import type {
  ChangeEvent,
  ForwardedRef,
  InputHTMLAttributes,
} from 'react'
import { cn } from '@/lib/utils'

interface PasswordInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  showStrengthIndicator?: boolean
}

const PASSWORD_THEME: ThemeConfig = {
  token: {
    borderRadius: 14,
    colorBgContainer: '#0E1C16',
    colorBorder: 'rgba(255,255,255,.10)',
    colorError: '#EF4444',
    colorPrimary: '#2ECC71',
    colorPrimaryHover: '#22C55E',
    colorText: '#FFFFFF',
    colorTextPlaceholder: '#94A3B8',
    controlHeight: 46,
    fontSize: 14,
  },
  components: {
    Input: {
      activeBorderColor: '#2ECC71',
      activeShadow: '0 0 0 3px rgba(46,204,113,.16)',
      errorActiveShadow: '0 0 0 3px rgba(239,68,68,.18)',
      hoverBorderColor: '#2ECC71',
      paddingInline: 14,
    },
    Progress: {
      defaultColor: '#2ECC71',
      remainingColor: 'rgba(255,255,255,.08)',
    },
  },
}

const STRENGTH_RULES = [
  { test: (password: string) => password.length >= 8, label: '8 caractères minimum' },
  { test: (password: string) => /[A-Z]/.test(password), label: 'Au moins une majuscule' },
  { test: (password: string) => /[0-9]/.test(password), label: 'Au moins un chiffre' },
  { test: (password: string) => /[^a-zA-Z0-9]/.test(password), label: 'Un caractère spécial' },
]

const STRENGTH_LEVELS = [
  { color: '#EF4444', label: 'Très faible' },
  { color: '#EF4444', label: 'Faible' },
  { color: '#FACC15', label: 'Moyenne' },
  { color: '#2ECC71', label: 'Bonne' },
  { color: '#22C55E', label: 'Forte' },
]

function assignRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') {
    ref(value)
  } else if (ref) {
    ref.current = value
  }
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    {
      label,
      error,
      hint,
      showStrengthIndicator = false,
      className,
      value,
      defaultValue,
      onChange,
      id,
      size,
      autoComplete,
      spellCheck,
      'aria-describedby': describedBy,
      ...props
    },
    ref
  ) {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const messageId = error || hint ? `${inputId}-message` : undefined
    const strengthId = showStrengthIndicator ? `${inputId}-strength` : undefined
    const ariaDescribedBy = [describedBy, messageId, strengthId]
      .filter(Boolean)
      .join(' ') || undefined
    const [internalValue, setInternalValue] = useState(() => String(defaultValue ?? ''))
    const passwordValue = value === undefined ? internalValue : String(value)
    const strength = STRENGTH_RULES.filter(rule => rule.test(passwordValue)).length
    const strengthLevel = STRENGTH_LEVELS[strength]

    const setInputRef = useCallback((instance: InputRef | null) => {
      if (instance?.input && size !== undefined) {
        instance.input.size = size
      }
      assignRef(ref, instance?.input ?? null)
    }, [ref, size])

    const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
      if (value === undefined) {
        setInternalValue(event.target.value)
      }
      onChange?.(event)
    }, [onChange, value])

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-[13px] font-semibold text-slate-300"
          >
            {label}
          </label>
        )}

        <ConfigProvider theme={PASSWORD_THEME}>
          <AntInput.Password
            {...props}
            ref={setInputRef}
            id={inputId}
            value={value}
            defaultValue={defaultValue}
            onChange={handleChange}
            status={error ? 'error' : undefined}
            aria-describedby={ariaDescribedBy}
            aria-invalid={error ? true : props['aria-invalid']}
            autoComplete={autoComplete || 'off'}
            spellCheck={spellCheck ?? false}
            suppressHydrationWarning
            iconRender={visible => (
              visible
                ? <EyeOff size={17} strokeWidth={1.8} role="img" aria-label="Masquer le mot de passe" />
                : <Eye size={17} strokeWidth={1.8} role="img" aria-label="Afficher le mot de passe" />
            )}
            className={cn(
              'h-[46px] w-full rounded-[14px] transition-colors',
              '[&_input]:font-mono [&_input]:tracking-wide',
              className
            )}
          />

          {showStrengthIndicator && passwordValue && (
            <div id={strengthId} className="mt-2.5" aria-live="polite">
              <Progress
                percent={strength * 25}
                showInfo={false}
                strokeColor={strengthLevel.color}
                trailColor="rgba(255,255,255,.08)"
                strokeLinecap="round"
                strokeWidth={10}
                className="mb-1 block leading-none"
              />
              <p className="text-xs font-medium" style={{ color: strengthLevel.color }}>
                Sécurité : {strengthLevel.label}
              </p>

              <div className="mt-2 grid gap-1.5">
                {STRENGTH_RULES.map(rule => {
                  const isValid = rule.test(passwordValue)
                  return (
                    <p
                      key={rule.label}
                      className={cn(
                        'flex items-center gap-1.5 text-xs transition-colors',
                        isValid ? 'text-emerald-400' : 'text-slate-500'
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded-full',
                          isValid
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-white/[.06] text-slate-500'
                        )}
                        aria-hidden="true"
                      >
                        {isValid
                          ? <Check size={10} strokeWidth={2.5} />
                          : <Minus size={10} strokeWidth={2.5} />}
                      </span>
                      {rule.label}
                    </p>
                  )
                })}
              </div>
            </div>
          )}
        </ConfigProvider>

        {error && (
          <p id={messageId} role="alert" className="mt-1 text-xs text-red-400">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={messageId} className="mt-1 text-xs text-slate-400">
            {hint}
          </p>
        )}
      </div>
    )
  }
)

PasswordInput.displayName = 'PasswordInput'
