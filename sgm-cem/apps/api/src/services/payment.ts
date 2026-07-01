import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'

const MTN_BASE  = process.env.MTN_MOMO_BASE_URL ?? 'https://sandbox.momodeveloper.mtn.com'
const MTN_ENV   = process.env.MTN_ENVIRONMENT   ?? 'sandbox'
const ORANGE_BASE = 'https://api.orange.com/orange-money-webpay/cm/v1'

// ─── MTN MoMo ────────────────────────────────────────────────────────
async function getMtnAccessToken(): Promise<string> {
  const key    = process.env.MTN_SUBSCRIPTION_KEY!
  const apiUser = process.env.MTN_API_USER!
  const apiKey  = process.env.MTN_API_KEY!
  const credentials = Buffer.from(`${apiUser}:${apiKey}`).toString('base64')

  const res = await axios.post(`${MTN_BASE}/collection/token/`,
    {}, {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Ocp-Apim-Subscription-Key': key,
      }
    }
  )
  return res.data.access_token
}

export interface PaymentResult {
  success: boolean
  transactionId: string
  status: 'PENDING' | 'CONFIRMED' | 'FAILED'
  message?: string
  externalId?: string
}

export async function requestMtnMoMo(params: {
  phone: string
  amount: number
  externalId: string
  note?: string
}): Promise<PaymentResult> {
  try {
    if (!process.env.MTN_SUBSCRIPTION_KEY) {
      return { success: false, transactionId: '', status: 'FAILED', message: 'MTN MoMo non configure' }
    }

    const token = await getMtnAccessToken()
    const transactionId = uuidv4()
    const phone = params.phone.startsWith('+237') ? params.phone.slice(4) : params.phone.replace(/\D/g, '')

    await axios.post(`${MTN_BASE}/collection/v1_0/requesttopay`,
      {
        amount: String(params.amount),
        currency: 'XAF',
        externalId: params.externalId,
        payer: { partyIdType: 'MSISDN', partyId: phone },
        payerMessage: params.note ?? 'Contribution CEM Melen',
        payeeNote: `SGM-CEM ${params.externalId}`,
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Reference-Id': transactionId,
          'X-Target-Environment': MTN_ENV,
          'Ocp-Apim-Subscription-Key': process.env.MTN_SUBSCRIPTION_KEY,
          'Content-Type': 'application/json',
        },
      }
    )

    return { success: true, transactionId, status: 'PENDING' }
  } catch (err) {
    console.error('[MTN MoMo]', err)
    const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message
    return { success: false, transactionId: '', status: 'FAILED', message: msg ?? 'Erreur MTN MoMo' }
  }
}

export async function getMtnMoMoStatus(transactionId: string): Promise<'PENDING' | 'CONFIRMED' | 'FAILED'> {
  try {
    const token = await getMtnAccessToken()
    const res = await axios.get(
      `${MTN_BASE}/collection/v1_0/requesttopay/${transactionId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Target-Environment': MTN_ENV,
          'Ocp-Apim-Subscription-Key': process.env.MTN_SUBSCRIPTION_KEY,
        },
      }
    )
    const s: string = res.data.status
    if (s === 'SUCCESSFUL') return 'CONFIRMED'
    if (s === 'FAILED')     return 'FAILED'
    return 'PENDING'
  } catch { return 'FAILED' }
}

// ─── Orange Money ──────────────────────────────────────────────────────
async function getOrangeAccessToken(): Promise<string> {
  const cred = Buffer.from(`${process.env.ORANGE_CLIENT_ID}:${process.env.ORANGE_CLIENT_SECRET}`).toString('base64')
  const res = await axios.post('https://api.orange.com/oauth/v3/token',
    'grant_type=client_credentials',
    { headers: { 'Authorization': `Basic ${cred}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  )
  return res.data.access_token
}

export async function requestOrangeMoney(params: {
  phone: string
  amount: number
  orderId: string
  description?: string
}): Promise<PaymentResult> {
  try {
    if (!process.env.ORANGE_CLIENT_ID) {
      return { success: false, transactionId: '', status: 'FAILED', message: 'Orange Money non configure' }
    }

    const token = await getOrangeAccessToken()
    const phone = params.phone.replace(/\D/g, '')

    const res = await axios.post(`${ORANGE_BASE}/webpayment`,
      {
        merchant_key: process.env.ORANGE_MERCHANT_KEY,
        currency: 'OUV',
        order_id: params.orderId,
        amount: params.amount,
        return_url: `${process.env.API_URL}/webhooks/orange/return`,
        cancel_url:  `${process.env.API_URL}/webhooks/orange/cancel`,
        notif_url:   `${process.env.API_URL}/webhooks/orange`,
        lang: 'fr',
        reference: params.orderId,
        customer_phone_number: `+237${phone}`,
        description: params.description ?? 'Contribution CEM Melen',
      },
      { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
    )

    return { success: true, transactionId: res.data.pay_token ?? params.orderId, status: 'PENDING' }
  } catch (err) {
    console.error('[Orange Money]', err)
    return { success: false, transactionId: '', status: 'FAILED', message: 'Erreur Orange Money' }
  }
}

// ─── Yelii Payment Gateway (MTN + Orange Money unifié) ──────────────────
const YELII_BASE = process.env.YELII_BASE_URL ?? 'https://api.yelii.xyz/api/yelii-pro-pay/v1'
const YELII_COLLECT_API_KEY = process.env.YELII_COLLECT_API_KEY || process.env.YELII_API_KEY

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
