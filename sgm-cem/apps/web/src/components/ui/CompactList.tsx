'use client'
import { Drawer, Grid } from 'antd'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Ligne de liste compacte sur deux lignes (UX-09) : qui / quoi à gauche,
 * montant / statut à droite. Le détail s'ouvre dans une DetailSheet.
 */
export function CompactRow({ leading, title, badge, subtitle, amount, status, onClick, highlighted, focusId }: {
  leading?: React.ReactNode
  title: string
  badge?: React.ReactNode
  subtitle?: React.ReactNode
  amount?: React.ReactNode
  status?: React.ReactNode
  onClick?: () => void
  highlighted?: boolean
  focusId?: string
}) {
  const body = (
    <>
      {leading && <span className="shrink-0">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-gray-800">{title}</span>
          {badge}
        </span>
        {subtitle && <span className="block truncate text-xs text-slate-500">{subtitle}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        {amount && <span className="font-mono text-sm font-bold text-[#1A6B1A]">{amount}</span>}
        {status}
      </span>
      {onClick && <ChevronRight size={16} className="shrink-0 text-gray-300" aria-hidden />}
    </>
  )
  const className = cn(
    'flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
    highlighted && 'bg-[#E8F5E8] ring-2 ring-inset ring-[#1A6B1A]',
  )
  return (
    <li data-focus-id={focusId} className="border-b border-gray-50 last:border-b-0">
      {onClick
        ? <button type="button" onClick={onClick} className={cn(className, 'hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1A6B1A]')}>{body}</button>
        : <div className={className}>{body}</div>}
    </li>
  )
}

/** Feuille de détail : glisse du bas sur mobile, panneau latéral sur grand écran. */
export function DetailSheet({ open, onClose, title, children, footer }: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const screens = Grid.useBreakpoint()
  const desktop = !!screens.md
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      footer={footer}
      placement={desktop ? 'right' : 'bottom'}
      size={desktop ? 440 : 'auto'}
      destroyOnHidden
      styles={desktop ? undefined : {
        wrapper: { height: 'auto', maxHeight: '88dvh' },
        section: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 'env(safe-area-inset-bottom)' },
      }}
    >
      {children}
    </Drawer>
  )
}

/** Paire libellé / valeur d'une feuille de détail. */
export function DetailLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-50 py-2.5 text-sm last:border-b-0">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 text-right font-medium text-gray-800 break-words">{children}</span>
    </div>
  )
}

/** Badge « Don public » (UX-10) ; une remise groupée est déjà nommée comme telle. */
export function ContributorBadge({ kind }: { kind: 'MEMBRE' | 'DON_PUBLIC' | 'REMISE_GROUPEE' }) {
  if (kind !== 'DON_PUBLIC') return null
  return <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-700">Don public</span>
}
