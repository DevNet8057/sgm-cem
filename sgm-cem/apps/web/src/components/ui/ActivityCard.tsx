'use client'

import { Card } from 'antd'
import type { KeyboardEvent, ReactNode } from 'react'
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
    'interactive-dash w-full rounded-[20px]! border-dash-border! bg-dash-card! text-left shadow-dash! transition-[transform,background-color,border-color,box-shadow] duration-[250ms] hover:-translate-y-0.5 hover:bg-dash-cardHover! hover:shadow-dash-hover!',
    unread && 'border-dash-primary/25! bg-dash-primary/[.06]!',
    onClick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 focus-visible:ring-offset-dash-bg',
    className
  )

  const content = (
    <div className="flex items-start gap-3">
      <span className="shrink-0">{avatar}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-dash-text">{title}</span>
          {timestamp !== undefined && (
            <span className="shrink-0 text-[11px] text-dash-textMuted">{timeAgo(timestamp)}</span>
          )}
        </span>
        {subtitle !== undefined && (
          <span className="mt-0.5 block truncate text-xs text-dash-textMuted">{subtitle}</span>
        )}
      </span>
      {trailing !== undefined && (
        <span className="min-w-0 max-w-[46%] shrink text-right text-dash-text [overflow-wrap:anywhere] [&_*]:max-w-full">
          {trailing}
        </span>
      )}
    </div>
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onClick()
  }

  return (
    <Card
      className={rootClassName}
      styles={{ body: { padding: 16 } }}
      onClick={onClick}
      onKeyDown={onClick ? handleKeyDown : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {content}
    </Card>
  )
}
