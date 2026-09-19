import crypto from 'crypto'
import { getConfig } from './config.service'

const YELII_DEFAULT_BASE_URL = 'https://api.yelii.xyz/api/yelii-pro-pay/v1'
const YELII_REQUEST_TIMEOUT_MS = 10_000

function getConfiguredValue(key: string): string | undefined {
  const value = getConfig(key)?.trim()
  return value || undefined
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return true

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number)
    if (octets.some(octet => octet > 255)) return true
    return octets[0] === 0
      || octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
  }

  return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')
}

function isSafePublicHttpUrl(value: string | undefined): value is string {
  if (!value) return false

  try {
    const url = new URL(value)
    const isProduction = getConfiguredValue('NODE_ENV') === 'production'
    const isHttpAllowed = url.protocol === 'https:' || (!isProduction && url.protocol === 'http:')
    return isHttpAllowed && !url.username && !url.password && !isPrivateOrLoopbackHost(url.hostname)
  } catch {
    return false
  }
}

function isAllowedYeliiBaseUrl(value: string | undefined): value is string {
  if (!isSafePublicHttpUrl(value)) return false

  const url = new URL(value)
  return url.hostname.toLowerCase() === 'api.yelii.xyz' && (url.port === '' || url.port === '443')
}

function normalizeCameroonMobilePhone(phone: string): string | undefined {
  let normalized = phone.replace(/\D/g, '')
  if (normalized.startsWith('00237')) normalized = normalized.slice(5)
  else if (normalized.startsWith('237')) normalized = normalized.slice(3)

  return /^6\d{8}$/.test(normalized) ? normalized : undefined
}

// Configuration lue AU MOMENT DE L'APPEL (jamais de constante figée au
// chargement du module) : un changement depuis le panneau développeur est
// pris en compte immédiatement, sans redémarrage (DEVELOPER_PANEL §3).
function getYeliiConfig() {
  const apiUrl = getConfiguredValue('API_URL')
  return {
    baseUrl: (getConfiguredValue('YELII_BASE_URL') ?? YELII_DEFAULT_BASE_URL).replace(/\/+$/, ''),
    // Certains déploiements historiques ne disposent que de YELII_API_KEY.
    // La clé de collecte reste prioritaire, mais un champ vide ne doit pas
    // empêcher MTN/Orange de fonctionner si la clé historique est valide.
    apiKey: getConfiguredValue('YELII_COLLECT_API_KEY') || getConfiguredValue('YELII_API_KEY'),
    webhookUrl: getConfiguredValue('YELII_WEBHOOK_URL') ?? (apiUrl ? `${apiUrl.replace(/\/+$/, '')}/webhooks/yelii` : undefined),
  }
}

export interface YeliiPaymentResult {
  success: boolean
  transactionId: string
  status: 'processing' | 'success' | 'failed' | 'cancelled'
  netAmount?: number
  message?: string
  code?:
    | 'YELII_NOT_CONFIGURED'
    | 'YELII_CONFIGURATION_INVALID'
    | 'YELII_VALIDATION'
    | 'YELII_UNAVAILABLE'
    | 'YELII_PROVIDER_REJECTED'
    | 'YELII_INVALID_RESPONSE'
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
      return { success: false, transactionId: '', status: 'failed', message: 'Yelii non configuré', code: 'YELII_NOT_CONFIGURED' }
    }
    if (!isAllowedYeliiBaseUrl(baseUrl) || !isSafePublicHttpUrl(webhookUrl)) {
      return { success: false, transactionId: '', status: 'failed', message: 'Configuration Yelii invalide', code: 'YELII_CONFIGURATION_INVALID' }
    }

    const phone = normalizeCameroonMobilePhone(params.senderPhone)
    if (!phone) {
      return { success: false, transactionId: '', status: 'failed', message: 'Numéro Mobile Money camerounais invalide', code: 'YELII_VALIDATION' }
    }

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
      signal: AbortSignal.timeout(YELII_REQUEST_TIMEOUT_MS),
      redirect: 'error',
    })

    if (!response.ok) {
      return { success: false, transactionId: '', status: 'failed', message: 'Le service de paiement est momentanément indisponible', code: 'YELII_UNAVAILABLE' }
    }

    const payload = (await response.json().catch(() => null)) as {
      success?: boolean
      data?: { transactionId?: string; status?: string; netCredited?: number }
      transactionId?: string
      status?: string
    } | null
    if (!payload) {
      return { success: false, transactionId: '', status: 'failed', message: 'Réponse Yelii invalide', code: 'YELII_INVALID_RESPONSE' }
    }
    if (payload.success === false) {
      return { success: false, transactionId: '', status: 'failed', message: 'Yelii a refusé l’initialisation du paiement', code: 'YELII_PROVIDER_REJECTED' }
    }

    const transactionId = payload?.data?.transactionId ?? payload?.transactionId ?? ''
    if (!transactionId.trim()) {
      return { success: false, transactionId: '', status: 'failed', message: 'Yelii n’a retourné aucune référence de transaction', code: 'YELII_INVALID_RESPONSE' }
    }
    const status = String(payload?.data?.status ?? payload?.status ?? 'processing').toLowerCase() as 'processing' | 'success' | 'failed' | 'cancelled'
    if (status === 'failed' || status === 'cancelled') {
      return {
        success: false,
        transactionId,
        status: 'failed',
        message: 'Yelii a refusé l’initialisation du paiement',
        code: 'YELII_PROVIDER_REJECTED',
      }
    }

    return {
      success: true,
      transactionId,
      status: status === 'success' ? 'success' : 'processing',
      netAmount: payload?.data?.netCredited,
    }
  } catch {
    console.warn('[Yelii] Initialisation indisponible ou délai dépassé')
    return { success: false, transactionId: '', status: 'failed', message: 'Erreur de connexion Yelii', code: 'YELII_UNAVAILABLE' }
  }
}

/**
 * Consulte le solde du wallet Yelii — utilisé par le panneau développeur
 * (« Tester la connexion ») pour vérifier que la clé API fonctionne.
 */
export async function getYeliiWalletBalance(): Promise<{ ok: boolean; balance?: number; message?: string }> {
  const { baseUrl, apiKey } = getYeliiConfig()
  if (!apiKey) return { ok: false, message: 'Clé API Yelii absente' }
  if (!isAllowedYeliiBaseUrl(baseUrl)) return { ok: false, message: 'Configuration Yelii invalide' }
  try {
    const response = await fetch(`${baseUrl}/wallet/balance`, {
      headers: { 'X-Collect-Api-Key': apiKey },
      signal: AbortSignal.timeout(YELII_REQUEST_TIMEOUT_MS),
      redirect: 'error',
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
  if (!apiKey || !isAllowedYeliiBaseUrl(baseUrl) || !transactionId.trim()) return { sent: false }

  try {
    const response = await fetch(
      `${baseUrl}/collect/callback/retry/${encodeURIComponent(transactionId)}`,
      {
        method: 'POST',
        headers: { 'X-Collect-Api-Key': apiKey },
        signal: AbortSignal.timeout(YELII_REQUEST_TIMEOUT_MS),
        redirect: 'error',
      }
    )

    const payload = (await response.json().catch(() => ({}))) as { success?: boolean; callback?: { sent?: boolean; status?: number } }
    return { sent: payload.success !== false && (payload.callback?.sent ?? response.ok), status: payload.callback?.status }
  } catch {
    console.warn('[Yelii] Relance du callback indisponible ou délai dépassé')
    return { sent: false }
  }
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
  if (!apiKey || !isAllowedYeliiBaseUrl(baseUrl) || !transactionId.trim()) {
    console.warn('[Yelii] Clé API absente — statut indéterminé')
    return { status: 'unknown' }
  }

  let response: Response
  try {
    response = await fetch(
      `${baseUrl}/collect/status/${encodeURIComponent(transactionId)}`,
      {
        headers: { 'X-Collect-Api-Key': apiKey },
        signal: AbortSignal.timeout(YELII_REQUEST_TIMEOUT_MS),
        redirect: 'error',
      }
    )
  } catch {
    console.warn('[Yelii] Erreur réseau ou délai dépassé lors de la consultation du statut — statut indéterminé')
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
    console.warn('[Yelii] Échec applicatif signalé par Yelii — statut indéterminé')
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
