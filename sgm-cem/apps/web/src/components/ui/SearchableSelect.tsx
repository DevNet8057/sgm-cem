'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

interface MenuPosition {
  top: number
  left: number
  width: number
  maxHeight: number
}

/** Champ de sélection avec recherche intégrée, positionné au-dessus de la page. */
export function SearchableSelect({
  label, value, onChange, options, placeholder = 'Rechercher…',
  required, error, emptyText = 'Aucun résultat', disabled,
}: SearchableSelectProps) {
  const triggerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const isOpenRef = useRef(false)
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const listboxId = useId()

  const selectedOption = useMemo(
    () => options.find(option => option.value === value),
    [options, value]
  )
  const filteredOptions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    if (!normalizedSearch) return options
    return options.filter(option =>
      option.label.toLowerCase().includes(normalizedSearch)
      || option.sublabel?.toLowerCase().includes(normalizedSearch)
    )
  }, [options, search])

  const updateMenuPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return

    const visualViewport = window.visualViewport
    const viewportTop = visualViewport?.offsetTop ?? 0
    const viewportLeft = visualViewport?.offsetLeft ?? 0
    const viewportWidth = visualViewport?.width ?? window.innerWidth
    const viewportHeight = visualViewport?.height ?? window.innerHeight
    const viewportBottom = viewportTop + viewportHeight
    const viewportRight = viewportLeft + viewportWidth
    const margin = 8
    const offset = 4
    const maximumHeight = 224
    const availableBelow = viewportBottom - rect.bottom - offset - margin
    const availableAbove = rect.top - viewportTop - offset - margin
    const openAbove = availableBelow < maximumHeight && availableAbove > availableBelow
    const maxHeight = Math.max(0, Math.min(maximumHeight, openAbove ? availableAbove : availableBelow))
    const left = Math.max(viewportLeft + margin, Math.min(rect.left, viewportRight - margin - rect.width))
    const width = Math.min(rect.width, viewportRight - left - margin)
    const top = openAbove
      ? Math.max(viewportTop + margin, rect.top - offset - maxHeight)
      : rect.bottom + offset

    setMenuPosition({ top, left, width, maxHeight })
  }, [])

  const openMenu = useCallback(() => {
    if (disabled) return
    updateMenuPosition()
    if (isOpenRef.current) return
    isOpenRef.current = true
    setSearch('')
    setActiveIndex(-1)
    setIsOpen(true)
  }, [disabled, updateMenuPosition])

  const closeMenu = useCallback(() => {
    isOpenRef.current = false
    setIsOpen(false)
    setActiveIndex(-1)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    const visualViewport = window.visualViewport
    visualViewport?.addEventListener('resize', updateMenuPosition)
    visualViewport?.addEventListener('scroll', updateMenuPosition)
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateMenuPosition)
    if (triggerRef.current) resizeObserver?.observe(triggerRef.current)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
      visualViewport?.removeEventListener('resize', updateMenuPosition)
      visualViewport?.removeEventListener('scroll', updateMenuPosition)
      resizeObserver?.disconnect()
    }
  }, [closeMenu, isOpen, updateMenuPosition])

  useEffect(() => {
    if (activeIndex >= filteredOptions.length) setActiveIndex(filteredOptions.length - 1)
  }, [activeIndex, filteredOptions.length])

  const selectOption = useCallback((option: SearchableSelectOption) => {
    onChange(option.value)
    setSearch('')
    closeMenu()
  }, [closeMenu, onChange])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return
    if (event.key === 'Tab') {
      closeMenu()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!isOpen) openMenu()
      setActiveIndex(index => Math.min(index + 1, filteredOptions.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!isOpen) openMenu()
      setActiveIndex(index => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter' && isOpen && activeIndex >= 0) {
      event.preventDefault()
      const option = filteredOptions[activeIndex]
      if (option) selectOption(option)
      return
    }
    if (event.key === 'Escape') closeMenu()
  }

  const inputValue = isOpen ? search : selectedOption?.label ?? ''

  return (
    <div className="block">
      {label && (
        <span className="text-xs font-semibold text-gray-600 block mb-1.5">
          {label} {required && <span className="text-red-500">*</span>}
        </span>
      )}

      <div
        ref={triggerRef}
        className={cn(
          'relative flex w-full items-center rounded-[10px] border border-gray-200 bg-white transition-colors',
          'focus-within:border-[#1A6B1A] focus-within:outline-none focus-within:ring-2 focus-within:ring-[#1A6B1A]/30',
          error && 'border-red-300 focus-within:border-red-400 focus-within:ring-red-200',
          disabled && 'cursor-not-allowed bg-gray-50 text-gray-400'
        )}
      >
        <Search size={14} className="ml-3 shrink-0 text-gray-400" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          disabled={disabled}
          placeholder={placeholder}
          role="combobox"
          aria-label={label ?? placeholder}
          aria-required={required}
          aria-invalid={Boolean(error)}
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls={isOpen ? listboxId : undefined}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          autoComplete="off"
          onFocus={openMenu}
          onClick={openMenu}
          onChange={event => {
            if (!isOpen) openMenu()
            setSearch(event.target.value)
            setActiveIndex(-1)
          }}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm text-gray-800 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
        />
        {value && !disabled && (
          <button
            type="button"
            onMouseDown={event => event.preventDefault()}
            onClick={() => {
              onChange('')
              setSearch('')
              inputRef.current?.focus()
            }}
            className="p-1 text-gray-300 transition-colors hover:text-gray-500"
            aria-label="Effacer la sélection"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
        <ChevronDown size={14} className="mr-3 shrink-0 text-gray-300" aria-hidden="true" />
      </div>

      {isOpen && menuPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          className="fixed z-[1000] overflow-y-auto rounded-[10px] border border-gray-200 bg-white py-1 shadow-lg"
          style={menuPosition}
        >
          {filteredOptions.length > 0 ? filteredOptions.map((option, index) => (
            <button
              key={option.value}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(option)}
              className={cn(
                'block w-full px-3 py-2 text-left transition-colors',
                index === activeIndex || option.value === value ? 'bg-[#1A6B1A]/10' : 'hover:bg-gray-50'
              )}
            >
              <p className="truncate text-sm font-medium text-gray-800">{option.label}</p>
              {option.sublabel && <p className="truncate text-xs text-gray-400">{option.sublabel}</p>}
            </button>
          )) : (
            <p className="px-3 py-2 text-xs text-gray-400">{emptyText}</p>
          )}
        </div>,
        document.body
      )}

      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}
