'use client'

import { Select as AntSelect } from 'antd'
import type { DefaultOptionType } from 'antd/es/select'
import { Search } from 'lucide-react'
import { useId, useMemo } from 'react'

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

interface RenderableOption extends DefaultOptionType {
  value: string
  label: string
  sublabel?: string
  searchText: string
}

/**
 * Champ Ant Design avec recherche sur le libellé et le sous-libellé.
 */
export function SearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Rechercher…',
  required,
  error,
  emptyText = 'Aucun résultat',
  disabled,
}: SearchableSelectProps) {
  const generatedId = useId()
  const selectId = `searchable-select-${generatedId.replace(/:/g, '')}`
  const errorId = error ? `${selectId}-error` : undefined
  const selectOptions = useMemo<RenderableOption[]>(
    () => options.map(option => ({
      ...option,
      searchText: `${option.label} ${option.sublabel ?? ''}`.toLocaleLowerCase('fr'),
    })),
    [options]
  )

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={selectId} className="mb-1.5 block text-[13px] font-semibold text-slate-300">
          {label}
          {required && <span className="ml-1 text-red-400" aria-hidden="true">*</span>}
        </label>
      )}
      <AntSelect<string, RenderableOption>
        id={selectId}
        value={value || undefined}
        options={selectOptions}
        onChange={nextValue => onChange(nextValue ?? '')}
        placeholder={placeholder}
        disabled={disabled}
        status={error ? 'error' : undefined}
        showSearch
        allowClear
        suffixIcon={<Search size={16} aria-hidden="true" />}
        filterOption={(inputValue, option) => (
          option?.searchText.includes(inputValue.trim().toLocaleLowerCase('fr')) ?? false
        )}
        optionRender={option => (
          <div className="min-w-0 py-1">
            <p className="truncate text-sm font-medium text-white">{option.data.label}</p>
            {option.data.sublabel && (
              <p className="truncate text-xs text-slate-400">{option.data.sublabel}</p>
            )}
          </div>
        )}
        notFoundContent={<span className="text-sm text-slate-400">{emptyText}</span>}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className="h-[46px] w-full [&_.ant-select-selector]:!h-[46px] [&_.ant-select-selector]:!rounded-[14px] [&_.ant-select-selection-item]:!leading-[44px] [&_.ant-select-selection-placeholder]:!leading-[44px]"
      />
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
