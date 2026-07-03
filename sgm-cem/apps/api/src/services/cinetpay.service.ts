import crypto from 'crypto'

export async function initiateCinetpayPayment(params: {
  transactionId: string
  amount: number
  description: string
  customerName: string
  customerSurname: string
}): Promise<{ paymentUrl: string }> {
  if (!process.env.CINETPAY_API_KEY || !process.env.CINETPAY_SITE_ID) {
    throw new Error('CinetPay non configuré — CINETPAY_API_KEY et CINETPAY_SITE_ID requis dans .env')
  }

  const response = await fetch('https://api-checkout.cinetpay.com/v2/payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: process.env.CINETPAY_API_KEY,
      site_id: process.env.CINETPAY_SITE_ID,
      transaction_id: params.transactionId,
      amount: params.amount,
      currency: 'XAF',
      description: params.description,
      return_url: `${(process.env.APP_URL ?? 'http://localhost:3000').split(',')[0]}/payment/return`,
      notify_url: `${process.env.API_URL ?? 'http://localhost:3001'}/webhooks/cinetpay`,
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
  if (!process.env.CINETPAY_API_KEY) return false
  const expected = crypto
    .createHash('md5')
    .update(
      (body.cpm_site_id ?? '') +
      (body.cpm_trans_id ?? '') +
      (body.cpm_amount ?? '') +
      process.env.CINETPAY_API_KEY
    )
    .digest('hex')
  return body.signature === expected
}
