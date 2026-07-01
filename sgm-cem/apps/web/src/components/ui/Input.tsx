'use client'
import { cn } from '@/lib/utils'
import { forwardRef } from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ label, error, hint, className, ...props }, ref) {
    return (
      <div className="w-full">
        {label && (
          <label className="text-xs font-semibold text-gray-600 block mb-1.5">{label}</label>
        )}
        <input
          ref={ref}
          suppressHydrationWarning
          className={cn(
            'w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A]',
            'disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed',
            error && 'border-red-300 focus:ring-red-200 focus:border-red-400',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        {hint && !error && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
      </div>
    )
  }
)

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  children: React.ReactNode
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ label, error, children, className, ...props }, ref) {
    return (
      <div className="w-full">
        {label && (
          <label className="text-xs font-semibold text-gray-600 block mb-1.5">{label}</label>
        )}
        <select
          ref={ref}
          suppressHydrationWarning
          className={cn(
            'w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm bg-white transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A]',
            error && 'border-red-300',
            className
          )}
          {...props}
        >
          {children}
        </select>
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      </div>
    )
  }
)

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ label, error, className, ...props }, ref) {
    return (
      <div className="w-full">
        {label && (
          <label className="text-xs font-semibold text-gray-600 block mb-1.5">{label}</label>
        )}
        <textarea
          ref={ref}
          suppressHydrationWarning
          className={cn(
            'w-full px-3 py-2.5 border border-gray-200 rounded-[10px] text-sm resize-none transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A]',
            error && 'border-red-300',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      </div>
    )
  }
)
