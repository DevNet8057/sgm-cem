import crypto from 'crypto'
import { getConfig } from './config.service'

const CINETPAY_PAYMENT_URL = 'https://api-checkout.cinetpay.com/v2/payment'
const CINETPAY_VERIFICATION_URL = 'https://api-checkout.cinetpay.com/v2/payment/check'

const CINETPAY_HMAC_FIELDS = [
  'cpm_site_id',
  'cpm_trans_id',
  'cpm_trans_date',
  'cpm_amount',
  'cpm_currency',
  'signature',
  'payment_method',
  'cel_phone_num',
  'cpm_phone_prefixe',
  'cpm_language',
  'cpm_version',
  'cpm_payment_config',
  'cpm_page_action',
  'cpm_custom',
  'cpm_designation',
  'cpm_error_message',
] as const

interface CinetpayInitiationResponse {
  code?: string
  message?: string
  description?: string
  data?: {
    payment_token?: string
    payment_url?: string
  }
  api_response_id?: string
}

export interface CinetpayVerificationData {
  amount: string
  currency: string
  status: string
  payment_method: string
  description: string
  metadata: string | null
  operator_id: string | null
  payment_date: string
  fund_availability_date: string
}

export interface CinetpayVerificationResponse {
  code: string
  message: string
  data?: CinetpayVerificationData
  description?: string
  api_response_id?: string
}

// Configuration relue à chaque usage pour appliquer immédiatement les changements du panneau développeur.
function getCinetpayConfig() {
  const appUrl = (getConfig('APP_URL') ?? 'http://localhost:3000').split(',')[0].replace(/\/+$/, '')
  const apiUrl = (getConfig('API_URL') ?? 'http://localhost:3001').split(',')[0].replace(/\/+$/, '')

  return {
    apiKey: getConfig('CINETPAY_API_KEY'),
    siteId: getConfig('CINETPAY_SITE_ID'),
    secretKey: getConfig('CINETPAY_SECRET_KEY'),
    returnUrl: getConfig('PAYMENT_RETURN_URL') ?? `${appUrl}/payment/return`,
    notifyUrl: `${apiUrl}/webhooks/cinetpay`,
  }
}

function sanitizeDescription(description: string): string {
  return description
    .replace(/[#\/$&_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isCinetpayConfigured(): boolean {
  const { apiKey, siteId, secretKey } = getCinetpayConfig()
  return Boolean(apiKey && siteId && secretKey)
}

export async function initiateCinetpayPayment(params: {
  transactionId: string
  amount: number
  description: string
  customerId: string
  customerName: string
  customerSurname: string
  customerPhone: string
  customerEmail: string
  customerAddress: string
  customerCity: string
  customerCountry: string
  customerState: string
  customerZipCode: string
}): Promise<{ paymentUrl: string }> {
  const { apiKey, siteId, returnUrl, notifyUrl } = getCinetpayConfig()
  if (!apiKey || !siteId) {
    throw new Error('CinetPay non configuré : la clé API et l’identifiant du site sont requis')
  }

  if (!Number.isInteger(params.amount) || params.amount <= 0 || params.amount % 5 !== 0) {
    throw new Error('Le montant CinetPay doit être un entier positif multiple de 5 FCFA')
  }

  const customerFields = [
    params.customerId,
    params.customerName,
    params.customerSurname,
    params.customerPhone,
    params.customerEmail,
    params.customerAddress,
    params.customerCity,
    params.customerCountry,
    params.customerState,
    params.customerZipCode,
  ]
  if (customerFields.some(value => !value.trim())) {
    throw new Error('Toutes les informations du client sont requises pour le paiement par carte')
  }

  const description = sanitizeDescription(params.description)
  if (!description) {
    throw new Error('La description du paiement CinetPay est requise')
  }

  const response = await fetch(CINETPAY_PAYMENT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: apiKey,
      site_id: siteId,
      transaction_id: params.transactionId,
      amount: params.amount,
      currency: 'XAF',
      description,
      return_url: returnUrl,
      notify_url: notifyUrl,
      customer_id: params.customerId.trim(),
      customer_name: params.customerName.trim(),
      customer_surname: params.customerSurname.trim(),
      customer_phone_number: params.customerPhone.trim(),
      customer_email: params.customerEmail.trim(),
      customer_address: params.customerAddress.trim(),
      customer_city: params.customerCity.trim(),
      customer_country: params.customerCountry.trim(),
      customer_state: params.customerState.trim(),
      customer_zip_code: params.customerZipCode.trim(),
      channels: 'CREDIT_CARD',
      lang: 'fr',
    }),
  })

  const data = await response.json().catch(() => null) as CinetpayInitiationResponse | null
  if (!data) {
    throw new Error('Réponse illisible reçue de CinetPay lors de l’initialisation')
  }
  if (!response.ok || data.code !== '201') {
    throw new Error(`Échec de l’initialisation CinetPay : ${data.message ?? `HTTP ${response.status}`}`)
  }

  const paymentUrl = data.data?.payment_url
  if (!paymentUrl) {
    throw new Error('CinetPay n’a retourné aucune URL de paiement')
  }

  return { paymentUrl }
}

export async function verifyCinetpayTransaction(
  transactionId: string
): Promise<CinetpayVerificationResponse> {
  const { apiKey, siteId } = getCinetpayConfig()
  if (!apiKey || !siteId) {
    throw new Error('CinetPay non configuré : la clé API et l’identifiant du site sont requis')
  }
  if (!transactionId.trim()) {
    throw new Error('L’identifiant de transaction CinetPay est requis')
  }

  const response = await fetch(CINETPAY_VERIFICATION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: apiKey,
      site_id: siteId,
      transaction_id: transactionId.trim(),
    }),
  })

  const data = await response.json().catch(() => null) as CinetpayVerificationResponse | null
  if (!data) {
    throw new Error('Réponse illisible reçue de CinetPay lors de la vérification')
  }
  if (!response.ok) {
    throw new Error(`Échec de la vérification CinetPay : ${data.message ?? `HTTP ${response.status}`}`)
  }

  return data
}

/** Calcule le x-token CinetPay selon l’ordre de concaténation officiel. */
export function computeCinetpayHmac(
  body: Record<string, string | undefined>,
  secret: string
): string {
  const payload = CINETPAY_HMAC_FIELDS
    .map(field => body[field] ?? '')
    .join('')

  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
}

/** Vérifie en temps constant le x-token reçu dans l’en-tête du webhook. */
export function verifyCinetpaySignature(
  body: Record<string, string | undefined>,
  receivedToken: string | undefined
): boolean {
  const { secretKey } = getCinetpayConfig()
  if (!secretKey || !receivedToken || !/^[a-f0-9]{64}$/i.test(receivedToken)) return false

  const expected = computeCinetpayHmac(body, secretKey)
  return crypto.timingSafeEqual(
    Buffer.from(receivedToken, 'hex'),
    Buffer.from(expected, 'hex')
  )
}
