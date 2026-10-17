'use client'
import { App } from 'antd'
import { formatAmount } from '@/lib/utils'

/**
 * Confirmation des actions financières (UX-07) : un geste imprécis ne doit
 * jamais confirmer un encaissement ou une réception de fonds. Récapitulatif
 * montant + personne avant validation, dialogue antd cohérent partout.
 */
export function useFinancialConfirm() {
  const { modal } = App.useApp()
  return (options: { title: string; amount: number; lines: Array<[string, string | undefined]>; okText: string; onOk: () => void }) => {
    modal.confirm({
      title: options.title,
      icon: null,
      centered: true,
      okText: options.okText,
      cancelText: 'Annuler',
      okButtonProps: { size: 'large' },
      cancelButtonProps: { size: 'large' },
      content: (
        <div className="mt-2 space-y-2">
          <p className="font-mono text-2xl font-bold text-[#1A6B1A]">{formatAmount(options.amount)}</p>
          <dl className="space-y-1 text-sm">
            {options.lines.filter(([, value]) => value).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-gray-500">{label}</dt>
                <dd className="text-right font-semibold text-gray-800">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ),
      onOk: options.onOk,
    })
  }
}
