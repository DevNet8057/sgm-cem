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
 * Statut distant d'une transaction Yelii.
 * 'unknown' = impossible de savoir (réseau, HTTP non-OK, clé absente) —
 * distinct de 'failed' : ne doit JAMAIS déclencher d'écriture en base.
 */
export type YeliiRemoteStatus = 'processing' | 'success' | 'failed' | 'unknown'

/** Statut distant enrichi — `amount` et `netCredited` sont absents si Yelii ne les fournit pas. */
export interface YeliiTransactionStatus {
  status: YeliiRemoteStatus
  amount?: number
  netCredited?: number
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
 * Consulte le statut d'une transaction Yelii, avec les montants associés
 * (`amount`, `netCredited`) quand Yelii les fournit — nécessaire à l'appelant
 * pour vérifier la cohérence du montant avant de confirmer un paiement
 * (contrôle anti-fraude, cf. webhooks/yelii.webhook.ts).
 * Utilisé en fallback si le webhook n'est pas reçu (polling toutes les 5s).
 * 'unknown' en cas d'incident (réseau, timeout, HTTP non-OK, clé absente,
 * échec applicatif Yelii) : l'appelant ne doit jamais interpréter une simple
 * micro-coupure comme un échec de paiement.
 */
export async function getYeliiTransaction(transactionId: string): Promise<YeliiTransactionStatus> {
  const { baseUrl, apiKey } = getYeliiConfig()
  if (!apiKey) {
    console.warn('[Yelii] Clé API absente — statut indéterminé')
    return { status: 'unknown' }
  }

  let response: Response
  try {
    response = await fetch(
      `${baseUrl}/collect/status/${transactionId}`,
      { headers: { 'X-Collect-Api-Key': apiKey }, signal: AbortSignal.timeout(8000) }
    )
  } catch (err) {
    console.warn('[Yelii] Erreur réseau ou délai dépassé lors de la consultation du statut — statut indéterminé', err)
    return { status: 'unknown' }
  }

  if (!response.ok) {
    console.warn(`[Yelii] Réponse HTTP ${response.status} — statut indéterminé`)
    return { status: 'unknown' }
  }

  const payload = await response.json().catch(() => null) as {
    success?: boolean
    message?: string
    data?: { status?: string; amount?: number; netCredited?: number }
    status?: string
  } | null
  if (!payload) {
    console.warn('[Yelii] Corps de réponse illisible — statut indéterminé')
    return { status: 'unknown' }
  }

  if (payload.success === false) {
    console.warn('[Yelii] Échec applicatif signalé par Yelii — statut indéterminé', payload.message)
    return { status: 'unknown' }
  }

  const s: string = String(payload?.data?.status ?? payload?.status ?? 'processing').toLowerCase()
  const amount = typeof payload?.data?.amount === 'number' ? payload.data.amount : undefined
  const netCredited = typeof payload?.data?.netCredited === 'number' ? payload.data.netCredited : undefined

  if (s === 'success' || s === 'successful' || s === 'completed') return { status: 'success', amount, netCredited }
  if (s === 'failed' || s === 'cancelled') return { status: 'failed', amount, netCredited }
  return { status: 'processing', amount, netCredited }
}

/**
 * Consulte le statut d'une transaction Yelii (sans les montants).
 * Utilisé par jobs/payment-reconciliation.ts — mince adaptateur au-dessus
 * de getYeliiTransaction pour conserver une signature publique stable.
 */
export async function getYeliiStatus(transactionId: string): Promise<YeliiRemoteStatus> {
  return (await getYeliiTransaction(transactionId)).status
}