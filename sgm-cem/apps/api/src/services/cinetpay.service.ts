import crypto from 'crypto'
import { getConfig } from './config.service'

// Configuration lue au moment de l'appel (panneau développeur → effet immédiat)
function getCinetpayConfig() {
  return {
    apiKey: getConfig('CINETPAY_API_KEY'),
    siteId: getConfig('CINETPAY_SITE_ID'),
    returnUrl: getConfig('PAYMENT_RETURN_URL')
      ?? `${(getConfig('APP_URL') ?? 'http://localhost:3000').split(',')[0]}/payment/return`,
    notifyUrl: `${getConfig('API_URL') ?? 'http://localhost:3001'}/webhooks/cinetpay`,
  }
}

export async function initiateCinetpayPayment(params: {
  transactionId: string
  amount: number
  description: string
  customerName: string
  customerSurname: string
}): Promise<{ paymentUrl: string }> {
  const { apiKey, siteId, returnUrl, notifyUrl } = getCinetpayConfig()
  if (!apiKey || !siteId) {
    throw new Error('CinetPay non configuré — CINETPAY_API_KEY et CINETPAY_SITE_ID requis (panneau développeur ou .env)')
  }

  const response = await fetch('https://api-checkout.cinetpay.com/v2/payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: apiKey,
      site_id: siteId,
      transaction_id: params.transactionId,
      amount: params.amount,
      currency: 'XAF',
      description: params.description,
      return_url: returnUrl,
      notify_url: notifyUrl,
      customer_name: params.customerName,
      customer_surname: params.customerSurname,
      channels: 'ALL',
      lang: 'fr',
    }),
  })

  const data = await response.json() as { code?: string; message?: string; data?: { payment_url?: string } }
  if (data.code !== '201') {
    throw new Error(`CinetPay error: ${data.message ?? 'Erreur inconnue'}`)
  }

  return { paymentUrl: data.data?.payment_url ?? '' }
}

/**
 * Vérifie la signature d'un webhook CinetPay.
 * CinetPay utilise MD5 : MD5(site_id + trans_id + amount + api_key)
 */
export function verifyCinetpaySignature(body: Record<string, string>): boolean {
  const { apiKey } = getCinetpayConfig()
  if (!apiKey) return false
  const expected = crypto
    .createHash('md5')
    .update(
      (body.cpm_site_id ?? '') +
      (body.cpm_trans_id ?? '') +
      (body.cpm_amount ?? '') +
      apiKey
    )
    .digest('hex')
  return body.signature === expected
}
