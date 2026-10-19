'use client'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// Sélecteur de période : flèches mois précédent / suivant, mois et année.
// value = null : toutes les périodes (listes) ; month = null : année entière.
export interface PeriodValue {
  year: number
  month: number | null
}

export const MOIS_LONGS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

export function periodLabel(p: PeriodValue | null): string {
  if (!p) return 'Toutes les périodes'
  return p.month ? `${MOIS_LONGS[p.month - 1]} ${p.year}` : `Année ${p.year}`
}

/** Paramètres d'API ?year=&month= correspondant à la période. */
export function periodParams(p: PeriodValue | null): { year?: number; month?: number } {
  if (!p) return {}
  return { year: p.year, ...(p.month ? { month: p.month } : {}) }
}

const FIRST_YEAR = 2020

export function PeriodPicker({ value, onChange, allowAll = false, tone = 'light', className }: {
  value: PeriodValue | null
  onChange: (value: PeriodValue | null) => void
  /** Ajoute « Toutes les périodes » (listes et historiques). */
  allowAll?: boolean
  /** dark : sur un fond foncé (bandeau du tableau de bord). */
  tone?: 'light' | 'dark'
  className?: string
}) {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const years = Array.from({ length: currentYear - FIRST_YEAR + 1 }, (_, i) => currentYear - i)

  // Décale d'un mois (ou d'une année si l'année entière est affichée)
  function shift(step: -1 | 1) {
    if (!value) return
    if (!value.month) return onChange({ year: value.year + step, month: null })
    const index = value.year * 12 + (value.month - 1) + step
    onChange({ year: Math.floor(index / 12), month: (index % 12) + 1 })
  }
  const atEnd = !!value && (value.month ? value.year * 12 + value.month >= currentYear * 12 + currentMonth : value.year >= currentYear)
  const atStart = !!value && (value.month ? value.year === FIRST_YEAR && value.month === 1 : value.year <= FIRST_YEAR)

  const field = tone === 'dark'
    ? 'border-white/20 bg-white text-slate-800'
    : 'border-gray-200 bg-white text-gray-700'
  const arrow = tone === 'dark'
    ? 'border-white/25 text-white hover:bg-white/15 disabled:opacity-30'
    : 'border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40'

  return (
    <div className={cn('flex items-center gap-1.5', className)} role="group" aria-label="Période">
      <button type="button" onClick={() => shift(-1)} disabled={!value || atStart}
        className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border transition-colors', arrow)}
        aria-label={value?.month ? 'Mois précédent' : 'Année précédente'}>
        <ChevronLeft size={16} />
      </button>
      <select aria-label="Mois" value={value ? (value.month ?? 0) : -1}
        onChange={e => {
          const m = Number(e.target.value)
          if (m === -1) return onChange(null)
          onChange({ year: value?.year ?? currentYear, month: m || null })
        }}
        className={cn('h-9 min-w-0 flex-1 rounded-[10px] border px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30', field)}>
        {allowAll && <option value={-1}>Toutes les périodes</option>}
        <option value={0}>Année entière</option>
        {MOIS_LONGS.map((m, i) => <option key={m} value={i + 1}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
      </select>
      {/* Changer d'année affiche l'année entière : on voit tout de suite ses données */}
      <select aria-label="Année" value={value?.year ?? ''} disabled={!value}
        onChange={e => onChange({ year: Number(e.target.value), month: null })}
        className={cn('h-9 w-[5.5rem] shrink-0 rounded-[10px] border px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 disabled:opacity-50', field)}>
        {!value && <option value="">—</option>}
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <button type="button" onClick={() => shift(1)} disabled={!value || atEnd}
        className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border transition-colors', arrow)}
        aria-label={value?.month ? 'Mois suivant' : 'Année suivante'}>
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
