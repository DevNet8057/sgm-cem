import crypto from 'crypto'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { computeCinetpayHmac } from '../src/services/cinetpay.service'

const SECRET = 'secret-cinetpay-test'

const completeBody = {
  cpm_site_id: '123456',
  cpm_trans_id: 'SGM-2026-ABC123',
  cpm_trans_date: '2026-08-02 12:34:56',
  cpm_amount: '12500',
  cpm_currency: 'XAF',
  signature: 'SIGNATURE-CINETPAY',
  payment_method: 'CARD',
  cel_phone_num: '699001122',
  cpm_phone_prefixe: '+237',
  cpm_language: 'fr',
  cpm_version: 'V2',
  cpm_payment_config: 'SINGLE',
  cpm_page_action: 'PAYMENT',
  cpm_custom: 'membre-42',
  cpm_designation: 'Contribution CM-2026',
  cpm_error_message: '',
}

describe('computeCinetpayHmac', () => {
  it('respecte l’ordre officiel de concaténation avec un body complet', () => {
    const officialPayload = [
      completeBody.cpm_site_id,
      completeBody.cpm_trans_id,
      completeBody.cpm_trans_date,
      completeBody.cpm_amount,
      completeBody.cpm_currency,
      completeBody.signature,
      completeBody.payment_method,
      completeBody.cel_phone_num,
      completeBody.cpm_phone_prefixe,
      completeBody.cpm_language,
      completeBody.cpm_version,
      completeBody.cpm_payment_config,
      completeBody.cpm_page_action,
      completeBody.cpm_custom,
      completeBody.cpm_designation,
      completeBody.cpm_error_message,
    ].join('')
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(officialPayload)
      .digest('hex')

    expect(computeCinetpayHmac(completeBody, SECRET)).toBe(expected)
    expect(computeCinetpayHmac(completeBody, SECRET)).toBe(expected)
  })

  it('produit un token différent lorsqu’un champ change', () => {
    const changedBody = { ...completeBody, cpm_amount: '12505' }

    expect(computeCinetpayHmac(changedBody, SECRET))
      .not.toBe(computeCinetpayHmac(completeBody, SECRET))
  })

  it('retourne exactement 64 caractères hexadécimaux', () => {
    const token = computeCinetpayHmac(completeBody, SECRET)

    expect(token).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('POST /webhooks/cinetpay', () => {
  it('rejette un résultat forgé dépourvu de x-token avant toute vérification', async () => {
    const response = await request(app)
      .post('/webhooks/cinetpay')
      .type('form')
      .send({
        cpm_trans_id: 'transaction-cinetpay-forgee',
        cpm_result: '00',
        cpm_amount: '12500',
      })

    expect(response.status).toBe(401)
    expect(response.text).toBe('Signature invalide')
  })
})
