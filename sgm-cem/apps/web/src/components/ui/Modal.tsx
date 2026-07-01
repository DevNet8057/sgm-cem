'use client'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}

export function Modal({ open, onClose, title, description, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' }

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-[fadein_0.15s_ease]" onClick={onClose} />
      <div className={cn(
        'relative w-full bg-white rounded-[20px] shadow-cem-xl animate-modal-in overflow-hidden',
        sizes[size]
      )}>
        <div className="absolute inset-y-0 left-0 w-1 bg-[#F5C400]" />
        <div className="pl-6 pr-5 pt-5 pb-4 flex items-start justify-between border-b border-gray-100">
          <div className="min-w-0 pr-3">
            {title && <h3 className="font-display font-semibold text-[#0F4A0F] text-xl">{title}</h3>}
            {description && <p className="text-sm text-gray-500 mt-0.5">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[8px] text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="pl-6 pr-5 py-5">{children}</div>
      </div>
    </div>
  )
}
