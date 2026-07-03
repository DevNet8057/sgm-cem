import crypto from 'crypto'

const YELII_BASE = process.env.YELII_BASE_URL ?? 'https://api.yelii.xyz/api/yelii-pro-pay/v1'
const YELII_COLLECT_API_KEY = process.env.YELII_COLLECT_API_KEY

export interface YeliiPaymentResult {
  success: boolean
  transactionId: string
  status: 'processing' | 'success' | 'failed' | 'cancelled'
  netAmount?: number
  message?: string
}

/**
 * Vérifie qu'un webhook entrant vient vraiment de Yelii.
 * À appeler EN PREMIER dans le handler webhook, avant tout traitement.
 */
export function verifyYeliiSignature(
  headers: Record<string, string | undefined>,
  rawBody: string
): boolean {
  const timestamp = headers['x-yelii-timestamp']
  const receivedSig = headers['x-yelii-signature']

  if (!timestamp || !receivedSig) return false

  // Rejette les webhooks de plus de 5 minutes (anti-replay)
  if (Math.abs(Date.now() - Number(timestamp)) > 300_000) return false

  const expected = crypto
    .createHmac('sha512', YELII_COLLECT_API_KEY!)
    .update(timestamp + rawBody)
    .digest('hex')

  try {
    return crypto.timingSafeEqual(
      Buffer.from(receivedSig, 'hex'),
      Buffer.from(expected, 'hex')
    )
  } catch {
    return false
  }
}

/**
 * Initie une collecte Mobile Money via Yelii (gère MTN MoMo et Orange Money).
 */
export async function initiateYeliiPayment(params: {
  amount: number
  senderPhone: string
  channel: 'orange_money' | 'mtn_money'
}): Promise<YeliiPaymentResult> {
  try {
    if (!YELII_COLLECT_API_KEY) {
      return { success: false, transactionId: '', status: 'failed', message: 'Yelii non configuré' }
    }

    const phone = params.senderPhone.startsWith('+237')
      ? params.senderPhone.slice(4)
      : params.senderPhone.replace(/\D/g, '')

    const response = await fetch(`${YELII_BASE}/collect/initiate`, {
      method: 'POST',
      headers: {
        'X-Collect-Api-Key': YELII_COLLECT_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: params.amount,
        senderPhone: phone,
        channel: params.channel,
        callbackUrl: `${process.env.API_URL}/webhooks/yelii`,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { message?: string }
      return { success: false, transactionId: '', status: 'failed', message: error.message ?? 'Erreur Yelii' }
    }

    const payload = (await response.json()) as { data?: { transactionId?: string; status?: string; netCredited?: number }; transactionId?: string; status?: string }
    const transactionId = payload?.data?.transactionId ?? payload?.transactionId ?? ''
    const status = String(payload?.data?.status ?? payload?.status ?? 'processing').toLowerCase() as 'processing' | 'success' | 'failed' | 'cancelled'

    return {
      success: true,
      transactionId,
      status: status === 'success' ? 'success' : status === 'failed' || status === 'cancelled' ? 'failed' : 'processing',
      netAmount: payload?.data?.netCredited,
    }
  } catch (err) {
    console.error('[Yelii]', err)
    return { success: false, transactionId: '', status: 'failed', message: 'Erreur de connexion Yelii' }
  }
}

/**
 * Rejoue le webhook d'une transaction Yelii (si le serveur était indisponible
 * lors de la notification initiale).
 */
export async function retryYeliiCallback(transactionId: string): Promise<{ sent: boolean; status?: number }> {
  if (!YELII_COLLECT_API_KEY) return { sent: false }

  const response = await fetch(
    `${YELII_BASE}/collect/callback/retry/${transactionId}`,
    { method: 'POST', headers: { 'X-Collect-Api-Key': YELII_COLLECT_API_KEY } }
  )

  const payload = (await response.json().catch(() => ({}))) as { callback?: { sent?: boolean; status?: number } }
  return { sent: payload.callback?.sent ?? response.ok, status: payload.callback?.status }
}

/**
 * Consulte le statut d'une transaction Yelii.
 * Utilisé en fallback si le webhook n'est pas reçu.
 */
export async function getYeliiStatus(transactionId: string): Promise<'processing' | 'success' | 'failed' | 'cancelled'> {
  try {
    if (!YELII_COLLECT_API_KEY) return 'failed'

    const response = await fetch(
      `${YELII_BASE}/collect/status/${transactionId}`,
      { headers: { 'X-Collect-Api-Key': YELII_COLLECT_API_KEY } }
    )

    if (!response.ok) return 'failed'

    const payload = (await response.json()) as { data?: { status?: string }; status?: string }
    const s: string = String(payload?.data?.status ?? payload?.status ?? 'processing').toLowerCase()

    if (s === 'success' || s === 'successful') return 'success'
    if (s === 'failed' || s === 'cancelled') return 'failed'
    return 'processing'
  } catch {
    return 'failed'
  }
}