'use client'
import { Select } from 'antd'
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
 * La gestion du popup et de la navigation clavier est déléguée à Ant Design.
 */
export function SearchableSelect({
  label, value, onChange, options, placeholder = 'Rechercher…',
  required, error, emptyText = 'Aucun résultat', disabled,
}: SearchableSelectProps) {
  return (
    <div className="block">
      {label && (
        <span className="text-xs font-semibold text-gray-600 block mb-1.5">
          {label} {required && <span className="text-red-500">*</span>}
        </span>
      )}

      <Select
        showSearch
        allowClear
        value={value || undefined}
        disabled={disabled}
        placeholder={placeholder}
        options={options}
        optionFilterProp="label"
        filterOption={(input, option) => {
          const search = input.trim().toLowerCase()
          const label = String(option?.label ?? '').toLowerCase()
          const sublabel = String((option as SearchableSelectOption | undefined)?.sublabel ?? '').toLowerCase()
          return label.includes(search) || sublabel.includes(search)
        }}
        optionRender={option => {
          const optionData = option.data as SearchableSelectOption
          return (
            <div>
              <p className="text-sm font-medium text-gray-800 truncate">{optionData.label}</p>
              {optionData.sublabel && (
                <p className="text-xs text-gray-400 truncate">{optionData.sublabel}</p>
              )}
            </div>
          )
        }}
        notFoundContent={<span className="text-xs text-gray-400">{emptyText}</span>}
        onChange={nextValue => onChange(nextValue ?? '')}
        prefix={<Search size={14} className="text-gray-400" aria-hidden="true" />}
        suffixIcon={<ChevronDown size={14} className="text-gray-300" aria-hidden="true" />}
        clearIcon={<X size={14} className="text-gray-300" aria-hidden="true" />}
        popupMatchSelectWidth
        listHeight={224}
        className={cn('w-full', error && 'searchable-select-error')}
        status={error ? 'error' : undefined}
        aria-label={label}
        aria-required={required}
        aria-invalid={Boolean(error)}
      />

      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}
