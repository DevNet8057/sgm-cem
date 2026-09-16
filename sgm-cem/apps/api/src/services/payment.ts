/**
 * Compatibilité avec l'ancien routeur contributions.
 * Le flux courant est implémenté dans yelii.service.ts ; ce petit adaptateur
 * conserve le contrat historique sans dupliquer l'intégration Yelii.
 */
import { initiateYeliiPayment, getYeliiStatus as getRemoteYeliiStatus } from './yelii.service'

export async function requestYelii(params: {
  phone: string
  amount: number
  externalId: string
  channel: 'MTN' | 'ORANGE'
  note?: string
}) {
  const result = await initiateYeliiPayment({
    amount: params.amount,
    senderPhone: params.phone,
    channel: params.channel === 'ORANGE' ? 'orange_money' : 'mtn_money',
  })
  return { ...result, externalId: params.externalId }
}

export async function getYeliiStatus(transactionId: string): Promise<'PENDING' | 'CONFIRMED' | 'FAILED'> {
  const status = await getRemoteYeliiStatus(transactionId)
  if (status === 'success') return 'CONFIRMED'
  if (status === 'failed') return 'FAILED'
  return 'PENDING'
}
