import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: React.ElementType
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-6 text-center animate-page-enter', className)}>
      <div className="w-20 h-20 bg-gray-100 rounded-[20px] flex items-center justify-center mb-5 animate-float">
        <Icon size={32} className="text-gray-300" />
      </div>
      <h3 className="font-display font-semibold text-gray-700 text-xl mb-2">{title}</h3>
      <p className="text-gray-400 text-sm max-w-xs leading-relaxed mb-6">{description}</p>
      {onAction && actionLabel && (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1A6B1A] text-white text-sm font-semibold rounded-[10px] shadow-cem hover:bg-[#0F4A0F] active:scale-[0.97] transition-all"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
