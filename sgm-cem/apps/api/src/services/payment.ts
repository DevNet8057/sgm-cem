import axios from 'axios'

// ─── Yelii Payment Gateway (MTN + Orange Money unifié) ──────────────────
// NOTE : tout l'ancien code d'intégration directe MTN MoMo / Orange Money
// (requestMtnMoMo, requestOrangeMoney, ...) a été supprimé — le projet passe
// exclusivement par Yelii Pro Pay (voir PAYMENT_FLOWS_SGM_CEM_2.md, étape 1).
const YELII_BASE = process.env.YELII_BASE_URL ?? 'https://api.yelii.xyz/api/yelii-pro-pay/v1'
const YELII_COLLECT_API_KEY = process.env.YELII_COLLECT_API_KEY || process.env.YELII_API_KEY

export interface PaymentResult {
  success: boolean
  transactionId: string
  status: 'PENDING' | 'CONFIRMED' | 'FAILED'
  message?: string
  externalId?: string
}

export async function requestYelii(params: {
  phone: string
  amount: number
  externalId: string
  channel: 'MTN' | 'ORANGE'
  note?: string
}): Promise<PaymentResult> {
  try {
    if (!YELII_COLLECT_API_KEY) {
      return { success: false, transactionId: '', status: 'FAILED', message: 'Yelii non configure' }
    }

    const phone = params.phone.startsWith('+237') ? params.phone.slice(4) : params.phone.replace(/\D/g, '')
    const channel = params.channel.toUpperCase() === 'ORANGE' ? 'orange_money' : 'mtn_money'

    const res = await axios.post(`${YELII_BASE}/collect/initiate`,
      {
        amount: params.amount,
        senderPhone: phone,
        channel,
        callbackUrl: `${process.env.API_URL}/webhooks/yelii`,
        partnerReference: params.externalId,
      },
      {
        headers: {
          'X-Collect-Api-Key': YELII_COLLECT_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    )

    const payload = res.data?.data ?? res.data
    const transactionId = payload?.transactionId ?? payload?.id ?? params.externalId
    const status = String(payload?.status ?? 'processing').toLowerCase()

    return {
      success: true,
      transactionId,
      externalId: params.externalId,
      status: status === 'success' ? 'CONFIRMED' : status === 'failed' ? 'FAILED' : 'PENDING',
    }
  } catch (err) {
    console.error('[Yelii]', err)
    const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message
    return { success: false, transactionId: '', status: 'FAILED', message: msg ?? 'Erreur Yelii' }
  }
}

export async function getYeliiStatus(transactionId: string): Promise<'PENDING' | 'CONFIRMED' | 'FAILED'> {
  try {
    if (!YELII_COLLECT_API_KEY) return 'FAILED'

    const res = await axios.get(
      `${YELII_BASE}/collect/status/${transactionId}`,
      {
        headers: {
          'X-Collect-Api-Key': YELII_COLLECT_API_KEY,
        },
      }
    )
    const payload = res.data?.data ?? res.data
    const s: string = String(payload?.status ?? 'processing').toLowerCase()
    if (s === 'success' || s === 'successful') return 'CONFIRMED'
    if (s === 'failed' || s === 'cancelled') return 'FAILED'
    return 'PENDING'
  } catch {
    return 'FAILED'
  }
}
