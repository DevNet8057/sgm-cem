'use client'

import type { ReactNode } from 'react'
import { cn, timeAgo } from '@/lib/utils'

interface ActivityCardProps {
  /** Avatar de personne (composant Avatar) ou puce icône générique. */
  avatar: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** Horodatage — affiché en relatif via timeAgo (ex. "Il y a 5 min"). */
  timestamp?: string | Date
  /** Contenu à droite (montant, badge de statut, etc.). */
  trailing?: ReactNode
  onClick?: () => void
  /** Met en avant la carte comme non lue (fond légèrement teinté). */
  unread?: boolean
  className?: string
}

export function ActivityCard({
  avatar, title, subtitle, timestamp, trailing, onClick, unread, className,
}: ActivityCardProps) {
  const rootClassName = cn(
    'interactive flex w-full items-start gap-3 rounded-[14px] border border-gray-100 bg-white p-3.5 text-left hover:shadow-cem',
    unread && 'bg-[#F2FFF4]',
    onClick && 'cursor-pointer',
    className
  )

  const content = (
    <>
      <span className="shrink-0">{avatar}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-slate-800">{title}</span>
          {timestamp !== undefined && (
            <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(timestamp)}</span>
          )}
        </span>
        {subtitle !== undefined && (
          <span className="mt-0.5 block truncate text-xs text-slate-400">{subtitle}</span>
        )}
      </span>
      {trailing !== undefined && <span className="shrink-0 text-right">{trailing}</span>}
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={rootClassName}>
        {content}
      </button>
    )
  }

  return <div className={rootClassName}>{content}</div>
}
