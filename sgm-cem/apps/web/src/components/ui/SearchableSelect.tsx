'use client'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SearchableSelectOption {
  value: string
  label: string
  sublabel?: string
}

interface SearchableSelectProps {
  label?: string
  value: string
  onChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  required?: boolean
  error?: string
  emptyText?: string
  disabled?: boolean
}

/**
 * Champ de sélection avec recherche intégrée (combobox).
 * L'utilisateur tape pour filtrer la liste en direct, puis choisit une option.
 */
export function SearchableSelect({
  label, value, onChange, options, placeholder = 'Rechercher…',
  required, error, emptyText = 'Aucun résultat', disabled,
}: SearchableSelectProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.value === value)

  // Synchroniser le texte affiché avec la sélection courante
  useEffect(() => {
    setQuery(selected ? selected.label : '')
  }, [selected?.value, selected?.label])

  // Fermer le menu au clic en dehors
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery(selected ? selected.label : '')
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [selected])

  const q = query.trim().toLowerCase()
  const showAll = !q || query === selected?.label
  const filtered = (showAll
    ? options
    : options.filter(o =>
        o.label.toLowerCase().includes(q) ||
        o.sublabel?.toLowerCase().includes(q)
      )
  ).slice(0, 50)

  function selectOption(o: SearchableSelectOption) {
    onChange(o.value)
    setQuery(o.label)
    setOpen(false)
    setHighlight(0)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { setOpen(true) }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const o = filtered[highlight]
      if (o) selectOption(o)
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery(selected ? selected.label : '')
    }
  }

  return (
    <div className="block relative" ref={wrapRef}>
      {label && (
        <span className="text-xs font-semibold text-gray-600 block mb-1.5">
          {label} {required && <span className="text-red-500">*</span>}
        </span>
      )}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => { setOpen(true); setHighlight(0) }}
          onChange={e => {
            setQuery(e.target.value)
            setOpen(true)
            setHighlight(0)
            if (value) onChange('')
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            'w-full pl-9 pr-8 py-2.5 border border-gray-200 rounded-[10px] text-sm bg-white transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-[#1A6B1A]/30 focus:border-[#1A6B1A]',
            error && 'border-red-300 focus:ring-red-200 focus:border-red-400',
            disabled && 'bg-gray-50 text-gray-400 cursor-not-allowed'
          )}
        />
        {value ? (
          <button type="button" onClick={() => { onChange(''); setQuery(''); setOpen(true) }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition-colors">
            <X size={14} />
          </button>
        ) : (
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
        )}
      </div>

      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-[10px] shadow-lg py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">{emptyText}</p>
          ) : (
            filtered.map((o, i) => (
              <button
                key={o.value}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => selectOption(o)}
                className={cn(
                  'w-full text-left px-3 py-2 transition-colors',
                  i === highlight ? 'bg-[#F0FDF4]' : 'hover:bg-gray-50',
                  o.value === value && 'bg-[#E8F5E8]'
                )}
              >
                <p className="text-sm font-medium text-gray-800 truncate">{o.label}</p>
                {o.sublabel && <p className="text-xs text-gray-400 truncate">{o.sublabel}</p>}
              </button>
            ))
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}
