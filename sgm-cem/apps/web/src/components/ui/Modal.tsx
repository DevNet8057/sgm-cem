'use client'
import { Modal as AntModal } from 'antd'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const MODAL_WIDTHS = {
  sm: 384,
  md: 448,
  lg: 672,
} as const

export function Modal({ open, onClose, title, description, children, size = 'md' }: ModalProps) {
  return (
    <AntModal
      open={open}
      onCancel={onClose}
      title={
        title || description ? (
          <div className="min-w-0 pr-10">
            {title && (
              <h2 className="m-0 text-xl font-semibold leading-tight text-white">
                {title}
              </h2>
            )}
            {description && (
              <p className="mb-0 mt-1 text-[13px] font-normal leading-relaxed text-[#94A3B8]">
                {description}
              </p>
            )}
          </div>
        ) : (
          <span className="sr-only">Fenêtre de dialogue</span>
        )
      }
      width={MODAL_WIDTHS[size]}
      centered
      footer={null}
      destroyOnHidden
      maskClosable
      keyboard
      focusTriggerAfterClose
      closable={{ 'aria-label': 'Fermer la fenêtre' }}
      closeIcon={<X aria-hidden="true" size={18} strokeWidth={1.8} />}
      style={{
        maxWidth: 'calc(100vw - 24px)',
        margin: 0,
        paddingBottom: 0,
      }}
      styles={{
        mask: {
          background: 'rgba(2, 8, 5, 0.78)',
          backdropFilter: 'blur(8px)',
        },
        content: {
          overflow: 'hidden',
          padding: 0,
          background: '#0E1C16',
          border: '1px solid rgba(255,255,255,.06)',
          borderLeft: '3px solid rgba(250,204,21,.72)',
          borderRadius: 20,
          boxShadow: '0 20px 40px rgba(0,0,0,.35)',
        },
        header: {
          margin: 0,
          padding: title || description ? '24px 24px 20px' : 0,
          background: '#0E1C16',
          borderBottom: title || description ? '1px solid rgba(255,255,255,.06)' : 'none',
        },
        body: {
          maxHeight: 'min(72vh, calc(100dvh - 144px))',
          overflowY: 'auto',
          padding: 24,
          color: '#FFFFFF',
        },
      }}
    >
      {children}
    </AntModal>
  )
}
