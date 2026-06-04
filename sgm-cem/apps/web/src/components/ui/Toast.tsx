'use client'
import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { cn } from '@/lib/utils'

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

const STYLES = {
  success: 'border-emerald-200 bg-white',
  error:   'border-red-200 bg-white',
  warning: 'border-amber-200 bg-white',
  info:    'border-blue-200 bg-white',
}

const ICON_STYLES = {
  success: 'text-emerald-500',
  error:   'text-red-500',
  warning: 'text-amber-500',
  info:    'text-blue-500',
}

const PROGRESS_STYLES = {
  success: 'bg-emerald-500',
  error:   'bg-red-500',
  warning: 'bg-amber-500',
  info:    'bg-blue-500',
}

export function ToastContainer() {
  const { toasts, removeToast } = useAppStore()

  return (
    <div className="fixed bottom-4 right-4 z-[500] flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <ToastItem key={toast.id} {...toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  )
}

function ToastItem({
  id, title, message, variant = 'info', duration = 4000, onClose
}: {
  id: string; title: string; message?: string; variant?: 'success' | 'error' | 'warning' | 'info'; duration?: number; onClose: () => void
}) {
  const [progress, setProgress] = useState(100)
  const Icon = ICONS[variant]

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(p => Math.max(0, p - (100 / (duration / 100))))
    }, 100)
    return () => clearInterval(interval)
  }, [duration])

  return (
    <div className={cn(
      'pointer-events-auto w-80 rounded-[14px] border shadow-[0_8px_32px_rgba(0,0,0,0.12)] overflow-hidden',
      'animate-toast-in',
      STYLES[variant]
    )}>
      <div className="flex items-start gap-3 p-4">
        <Icon size={18} className={cn('mt-0.5 flex-shrink-0', ICON_STYLES[variant])} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          {message && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{message}</p>}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0">
          <X size={14} />
        </button>
      </div>
      <div className="h-0.5 bg-gray-100">
        <div
          className={cn('h-full transition-all ease-linear', PROGRESS_STYLES[variant])}
          style={{ width: `${progress}%`, transitionDuration: '100ms' }}
        />
      </div>
    </div>
  )
}
