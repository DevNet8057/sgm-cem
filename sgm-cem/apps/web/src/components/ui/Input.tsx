'use client'

import { ConfigProvider, Input as AntInput, Select as AntSelect } from 'antd'
import type {
  InputRef,
  RefSelectProps,
  SelectProps as AntSelectProps,
  ThemeConfig,
} from 'antd'
import { forwardRef, useCallback, useId } from 'react'
import type { ForwardedRef } from 'react'
import { cn } from '@/lib/utils'

const FIELD_THEME: ThemeConfig = {
  token: {
    borderRadius: 14,
    colorBgContainer: '#0E1C16',
    colorBorder: 'rgba(255,255,255,.10)',
    colorError: '#EF4444',
    colorPrimary: '#2ECC71',
    colorPrimaryHover: '#22C55E',
    colorText: '#FFFFFF',
    colorTextPlaceholder: '#94A3B8',
    controlHeight: 46,
    fontSize: 14,
  },
  components: {
    Input: {
      activeBorderColor: '#2ECC71',
      activeShadow: '0 0 0 3px rgba(46,204,113,.16)',
      errorActiveShadow: '0 0 0 3px rgba(239, 68, 68, 0.18)',
      hoverBorderColor: '#2ECC71',
      paddingInline: 14,
    },
    Select: {
      activeBorderColor: '#2ECC71',
      activeOutlineColor: 'rgba(46,204,113,.16)',
      hoverBorderColor: '#2ECC71',
      optionActiveBg: '#13261E',
      optionSelectedBg: 'rgba(46,204,113,.18)',
      optionSelectedColor: '#FFFFFF',
    },
  },
}

const LABEL_CLASS_NAME = 'mb-1.5 block text-[13px] font-semibold text-slate-300'
const MESSAGE_CLASS_NAME = 'mt-1 text-xs'

function assignRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') {
    ref(value)
  } else if (ref) {
    ref.current = value
  }
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input(
    {
      label,
      error,
      hint,
      className,
      id,
      size,
      'aria-describedby': describedBy,
      ...props
    },
    ref
  ) {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const messageId = error || hint ? `${inputId}-message` : undefined
    const ariaDescribedBy = [describedBy, messageId].filter(Boolean).join(' ') || undefined
    const setInputRef = useCallback((instance: InputRef | null) => {
      if (instance?.input && size !== undefined) {
        instance.input.size = size
      }
      assignRef(ref, instance?.input ?? null)
    }, [ref, size])

    return (
      <div className="w-full">
        {label && <label htmlFor={inputId} className={LABEL_CLASS_NAME}>{label}</label>}
        <ConfigProvider theme={FIELD_THEME}>
          <AntInput
            {...props}
            ref={setInputRef}
            id={inputId}
            status={error ? 'error' : undefined}
            aria-describedby={ariaDescribedBy}
            aria-invalid={error ? true : props['aria-invalid']}
            suppressHydrationWarning
            className={cn(
              'h-[46px] w-full rounded-[14px] transition-colors',
              className
            )}
          />
        </ConfigProvider>
        {error && <p id={messageId} role="alert" className={cn(MESSAGE_CLASS_NAME, 'text-red-400')}>{error}</p>}
        {hint && !error && <p id={messageId} className={cn(MESSAGE_CLASS_NAME, 'text-slate-400')}>{hint}</p>}
      </div>
    )
  }
)

interface SelectProps extends Omit<AntSelectProps, 'status'> {
  label?: string
  error?: string
}

export const Select = forwardRef<RefSelectProps, SelectProps>(
  function Select(
    { label, error, children, className, id, 'aria-describedby': describedBy, ...props },
    ref
  ) {
    const generatedId = useId()
    const selectId = id ?? generatedId
    const messageId = error ? `${selectId}-message` : undefined
    const ariaDescribedBy = [describedBy, messageId].filter(Boolean).join(' ') || undefined

    return (
      <div className="w-full">
        {label && <label htmlFor={selectId} className={LABEL_CLASS_NAME}>{label}</label>}
        <ConfigProvider theme={FIELD_THEME}>
          <AntSelect
            {...props}
            ref={ref}
            id={selectId}
            status={error ? 'error' : undefined}
            aria-describedby={ariaDescribedBy}
            aria-invalid={error ? true : props['aria-invalid']}
            className={cn('h-[46px] w-full rounded-[14px] transition-colors', className)}
            popupClassName="premium-select-popup"
          >
            {children}
          </AntSelect>
        </ConfigProvider>
        {error && <p id={messageId} role="alert" className={cn(MESSAGE_CLASS_NAME, 'text-red-400')}>{error}</p>}
      </div>
    )
  }
)

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  hint?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      label,
      error,
      hint,
      className,
      id,
      'aria-describedby': describedBy,
      ...props
    },
    ref
  ) {
    const generatedId = useId()
    const textareaId = id ?? generatedId
    const messageId = error || hint ? `${textareaId}-message` : undefined
    const ariaDescribedBy = [describedBy, messageId].filter(Boolean).join(' ') || undefined

    return (
      <div className="w-full">
        {label && <label htmlFor={textareaId} className={LABEL_CLASS_NAME}>{label}</label>}
        <ConfigProvider theme={FIELD_THEME}>
          <AntInput.TextArea
            {...props}
            ref={instance => assignRef(ref, instance?.resizableTextArea?.textArea ?? null)}
            id={textareaId}
            status={error ? 'error' : undefined}
            aria-describedby={ariaDescribedBy}
            aria-invalid={error ? true : props['aria-invalid']}
            suppressHydrationWarning
            className={cn(
              'min-h-[46px] w-full resize-none rounded-[14px] transition-colors',
              className
            )}
          />
        </ConfigProvider>
        {error && <p id={messageId} role="alert" className={cn(MESSAGE_CLASS_NAME, 'text-red-400')}>{error}</p>}
        {hint && !error && <p id={messageId} className={cn(MESSAGE_CLASS_NAME, 'text-slate-400')}>{hint}</p>}
      </div>
    )
  }
)
