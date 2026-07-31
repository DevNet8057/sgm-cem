'use client'
import { useEffect, useState } from 'react'
import { Button as AntButton } from 'antd'
import { CheckCircle2, FileText, Download, Share2 } from 'lucide-react'
import api from '@/lib/api'
import { getBaseURL } from '@/lib/api'
import { formatAmount } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'

interface ReceiptSuccessContentProps {
  contributionId: string
  initialReceiptUrl?: string | null
  memberName?: string
  amount?: number
  rubriqueLabel?: string
}

/**
 * Confirmation de paiement + présentation du reçu (jamais envoyé automatiquement).
 * Le PDF Puppeteer n'est pas toujours prêt immédiatement après confirmation : on
 * interroge /payments/status en retry court, comme dans PaymentStepper. Les actions
 * (Afficher/Télécharger/Partager) restent utilisables dès le départ via la route de
 * secours /contributions/:id/receipt — jamais de bouton désactivé qui bloquerait
 * l'utilisateur pendant la finalisation.
 */
export function ReceiptSuccessContent({
  contributionId,
  initialReceiptUrl = null,
  memberName,
  amount,
  rubriqueLabel,
}: ReceiptSuccessContentProps) {
  const [receiptUrl, setReceiptUrl] = useState<string | null>(initialReceiptUrl)
  const [receiptTimedOut, setReceiptTimedOut] = useState(false)
  const [receiptAttempt, setReceiptAttempt] = useState(0)

  useEffect(() => {
    setReceiptUrl(initialReceiptUrl)
    setReceiptTimedOut(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contributionId])

  useEffect(() => {
    if (receiptUrl || !contributionId) return
    setReceiptTimedOut(false)
    let tries = 0
    const iv = setInterval(async () => {
      tries += 1
      try {
        const r = await api.get(`/payments/status/${contributionId}`)
        const url = (r.data.data.receiptUrl ?? null) as string | null
        if (url) {
          setReceiptUrl(url)
          clearInterval(iv)
          return
        }
      } catch { /* réessai au prochain tick */ }
      if (tries >= 10) {
        clearInterval(iv)
        setReceiptTimedOut(true)
      }
    }, 1500)
    return () => clearInterval(iv)
  }, [receiptUrl, contributionId, receiptAttempt])

  // Toujours utilisable : la route de secours génère/attend le reçu à la demande,
  // même si le PDF Puppeteer n'est pas encore prêt côté client.
  const fallbackUrl = `${getBaseURL()}/contributions/${contributionId}/receipt`
  const actionUrl = receiptUrl ?? fallbackUrl
  const hasSummary = memberName != null || rubriqueLabel != null || amount != null

  const statusLabel = receiptUrl
    ? 'Reçu prêt'
    : receiptTimedOut
      ? 'Le reçu met plus de temps que prévu à se générer.'
      : 'Finalisation du reçu…'

  return (
    <div className="py-2 text-center space-y-4">
      <div className="w-16 h-16 rounded-full bg-[#E8F5E8] flex items-center justify-center mx-auto">
        <CheckCircle2 size={32} className="text-[#1A6B1A]" />
      </div>
      <div>
        <h3 className="font-display font-semibold text-white text-xl mb-1">Paiement confirmé !</h3>
        <p className="text-sm text-[#94A3B8]">La contribution est bien enregistrée.</p>
        <p aria-live="polite" className="text-xs text-[#94A3B8] mt-1 flex items-center justify-center gap-1.5">
          {statusLabel}
          {receiptTimedOut && (
            <button
              type="button"
              onClick={() => { setReceiptTimedOut(false); setReceiptAttempt(a => a + 1) }}
              className="text-[#1A6B1A] hover:underline font-semibold"
            >
              Réessayer
            </button>
          )}
        </p>
      </div>

      {hasSummary && (
        <div className="rounded-[12px] bg-[#0F172A]/40 border border-white/10 px-4 py-3 text-left space-y-1.5">
          {memberName != null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#94A3B8]">Membre</span>
              <span className="text-white font-medium">{memberName}</span>
            </div>
          )}
          {rubriqueLabel != null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#94A3B8]">Rubrique</span>
              <span className="text-white font-medium">{rubriqueLabel}</span>
            </div>
          )}
          {amount != null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#94A3B8]">Montant</span>
              <span className="text-white font-semibold font-mono">{formatAmount(amount)}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <AntButton type="primary" icon={<FileText size={14} />} href={actionUrl} target="_blank" rel="noopener noreferrer">
          Afficher
        </AntButton>
        <AntButton icon={<Download size={14} />} href={actionUrl} download target="_blank" rel="noopener noreferrer">
          Télécharger
        </AntButton>
        <AntButton
          icon={<Share2 size={14} />}
          onClick={async () => {
            const text = 'Reçu de contribution — CEM Melen'
            if (typeof navigator !== 'undefined' && navigator.share) {
              try { await navigator.share({ title: 'Reçu CEM Melen', text, url: actionUrl }); return } catch { /* partage annulé */ }
            }
            window.open(`https://wa.me/?text=${encodeURIComponent(`${text} : ${actionUrl}`)}`, '_blank', 'noopener,noreferrer')
          }}
        >
          Partager
        </AntButton>
      </div>
    </div>
  )
}

interface ReceiptSuccessModalProps extends ReceiptSuccessContentProps {
  open: boolean
  onClose: () => void
}

/** Variante autonome (modale complète) de ReceiptSuccessContent, pour un usage hors stepper. */
export function ReceiptSuccessModal({ open, onClose, ...content }: ReceiptSuccessModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Paiement confirmé" size="sm">
      <ReceiptSuccessContent {...content} />
    </Modal>
  )
}
