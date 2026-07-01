'use client'
import { useState, forwardRef } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PasswordInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  showStrengthIndicator?: boolean
}

const STRENGTH_RULES = [
  { test: (p: string) => p.length >= 8, label: '8 caractères minimum' },
  { test: (p: string) => /[A-Z]/.test(p), label: 'Au moins une majuscule' },
  { test: (p: string) => /[0-9]/.test(p), label: 'Au moins un chiffre' },
  { test: (p: string) => /[^a-zA-Z0-9]/.test(p), label: 'Un caractère spécial' },
]

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    { label, error, hint, showStrengthIndicator = false, className, value, onChange, ...props },
    ref
  ) {
    const [showPassword, setShowPassword] = useState(false)
    const passwordValue = String(value || '')
    const validRules = STRENGTH_RULES.filter(r => r.test(passwordValue))
    const strength = validRules.length
    const strengthColor = ['bg-red-500', 'bg-red-500', 'bg-yellow-500', 'bg-yellow-500', 'bg-green-500'][strength]
    const strengthLabel = ['', 'Faible', 'Faible', 'Moyen', 'Fort'][strength]

    return (
      <div className="w-full">
        {label && (
          <label className="text-xs font-semibold text-gray-600 block mb-1.5">{label}</label>
        )}

        <div className="relative">
          <input
            ref={ref}
            type={showPassword ? 'text' : 'password'}
            value={value}
            onChange={onChange}
            suppressHydrationWarning
            className={cn(
              'w-full px-3 py-2.5 pr-10 border border-gray-200 rounded-[10px] text-sm transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A]',
              'disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed',
              'font-mono tracking-wide', // Font monospace pour obscurcir les patterns
              error && 'border-red-300 focus:ring-red-200 focus:border-red-400',
              className
            )}
            autoComplete={props.autoComplete || 'off'}
            spellCheck="false"
            {...props}
          />

          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none transition-colors p-0.5"
            aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {/* Strength indicator */}
        {showStrengthIndicator && passwordValue && (
          <div className="mt-2">
            <div className="flex gap-1 mb-1">
              {[1, 2, 3, 4].map(i => (
                <div
                  key={i}
                  className={cn(
                    'flex-1 h-1 rounded-full transition-all',
                    i <= strength ? strengthColor : 'bg-gray-200'
                  )}
                />
              ))}
            </div>
            <p className={cn(
              'text-xs font-medium',
              strength >= 3 ? 'text-green-600' : strength >= 2 ? 'text-yellow-600' : 'text-red-500'
            )}>
              Sécurité: {strengthLabel}
            </p>
          </div>
        )}

        {/* Rules checklist */}
        {showStrengthIndicator && passwordValue && (
          <div className="mt-2 space-y-1">
            {STRENGTH_RULES.slice(0, 3).map(rule => (
              <p
                key={rule.label}
                className={cn(
                  'text-xs flex items-center gap-1.5 transition-colors',
                  rule.test(passwordValue) ? 'text-green-600' : 'text-gray-400'
                )}
              >
                <span className={cn(
                  'w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold',
                  rule.test(passwordValue) ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-400'
                )}>
                  {rule.test(passwordValue) ? '✓' : '·'}
                </span>
                {rule.label}
              </p>
            ))}
          </div>
        )}

        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        {hint && !error && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
      </div>
    )
  }
)

PasswordInput.displayName = 'PasswordInput'
