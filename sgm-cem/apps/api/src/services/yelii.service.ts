import crypto from 'crypto'
import { getConfig } from './config.service'

// Configuration lue AU MOMENT DE L'APPEL (jamais de constante figée au
// chargement du module) : un changement depuis le panneau développeur est
// pris en compte immédiatement, sans redémarrage (DEVELOPER_PANEL §3).
function getYeliiConfig() {
  return {
    baseUrl: getConfig('YELII_BASE_URL') ?? 'https://api.yelii.xyz/api/yelii-pro-pay/v1',
    apiKey: getConfig('YELII_COLLECT_API_KEY'),
    webhookUrl: getConfig('YELII_WEBHOOK_URL') ?? `${getConfig('API_URL')}/webhooks/yelii`,
  }
}

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

  const { apiKey } = getYeliiConfig()
  if (!apiKey) return false

  const expected = crypto
    .createHmac('sha512', apiKey)
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
    const { baseUrl, apiKey, webhookUrl } = getYeliiConfig()
    if (!apiKey) {
      return { success: false, transactionId: '', status: 'failed', message: 'Yelii non configuré' }
    }

    const phone = params.senderPhone.startsWith('+237')
      ? params.senderPhone.slice(4)
      : params.senderPhone.replace(/\D/g, '')

    const response = await fetch(`${baseUrl}/collect/initiate`, {
      method: 'POST',
      headers: {
        'X-Collect-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: params.amount,
        senderPhone: phone,
        channel: params.channel,
        callbackUrl: webhookUrl,
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
 * Consulte le solde du wallet Yelii — utilisé par le panneau développeur
 * (« Tester la connexion ») pour vérifier que la clé API fonctionne.
 */
export async function getYeliiWalletBalance(): Promise<{ ok: boolean; balance?: number; message?: string }> {
  const { baseUrl, apiKey } = getYeliiConfig()
  if (!apiKey) return { ok: false, message: 'Clé API Yelii absente' }
  try {
    const response = await fetch(`${baseUrl}/wallet/balance`, {
      headers: { 'X-Collect-Api-Key': apiKey },
    })
    if (!response.ok) return { ok: false, message: `Yelii a répondu HTTP ${response.status}` }
    const payload = (await response.json().catch(() => ({}))) as { data?: { balance?: number }; balance?: number }
    return { ok: true, balance: payload?.data?.balance ?? payload?.balance }
  } catch {
    return { ok: false, message: 'Connexion à Yelii impossible' }
  }
}

/**
 * Rejoue le webhook d'une transaction Yelii (si le serveur était indisponible
 * lors de la notification initiale).
 */
export async function retryYeliiCallback(transactionId: string): Promise<{ sent: boolean; status?: number }> {
  const { baseUrl, apiKey } = getYeliiConfig()
  if (!apiKey) return { sent: false }

  const response = await fetch(
    `${baseUrl}/collect/callback/retry/${transactionId}`,
    { method: 'POST', headers: { 'X-Collect-Api-Key': apiKey } }
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
    const { baseUrl, apiKey } = getYeliiConfig()
    if (!apiKey) return 'failed'

    const response = await fetch(
      `${baseUrl}/collect/status/${transactionId}`,
      { headers: { 'X-Collect-Api-Key': apiKey } }
    )

    if (!response.ok) return 'failed'

    const payload = (await response.json()) as { data?: { status?: string }; status?: string }
    const s: string = String(payload?.data?.status ?? payload?.status ?? 'processing').toLowerCase()

    if (s === 'success' || s === 'successful' || s === 'completed') return 'success'
    if (s === 'failed' || s === 'cancelled') return 'failed'
    return 'processing'
  } catch {
    return 'failed'
  }
}