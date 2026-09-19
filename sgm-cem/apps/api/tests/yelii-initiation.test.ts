import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __clearConfigCacheForTests } from '../src/services/config.service'
import { initiateYeliiPayment } from '../src/services/yelii.service'

const YELII_CONFIG_KEYS = ['YELII_COLLECT_API_KEY', 'YELII_API_KEY', 'YELII_BASE_URL', 'YELII_WEBHOOK_URL', 'API_URL'] as const
const configurationInitiale = new Map(YELII_CONFIG_KEYS.map(key => [key, process.env[key]]))

function configureYelii() {
  process.env.YELII_COLLECT_API_KEY = 'cle-yelii-test'
  delete process.env.YELII_API_KEY
  process.env.YELII_BASE_URL = 'https://api.yelii.xyz/api/yelii-pro-pay/v1'
  process.env.YELII_WEBHOOK_URL = 'https://api.sgm-cem.test/webhooks/yelii'
  process.env.API_URL = 'https://api.sgm-cem.test'
  __clearConfigCacheForTests()
}

beforeEach(() => {
  configureYelii()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  __clearConfigCacheForTests()
})

afterAll(() => {
  for (const key of YELII_CONFIG_KEYS) {
    const value = configurationInitiale.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  __clearConfigCacheForTests()
})

describe('initiateYeliiPayment', () => {
  it('échoue sans contacter Yelii lorsque la clé de collecte est absente', async () => {
    delete process.env.YELII_COLLECT_API_KEY
    delete process.env.YELII_API_KEY
    __clearConfigCacheForTests()

    const result = await initiateYeliiPayment({ amount: 100, senderPhone: '657546880', channel: 'orange_money' })

    expect(fetch).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: false, transactionId: '', status: 'failed', code: 'YELII_NOT_CONFIGURED' })
  })

  it('normalise le numéro camerounais 657546880 avant l’appel Orange Money', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { transactionId: 'orange-100', status: 'processing' } }),
    })

    await initiateYeliiPayment({ amount: 100, senderPhone: '+237 657 546 880', channel: 'orange_money' })

    expect(fetch).toHaveBeenCalledWith(
      'https://api.yelii.xyz/api/yelii-pro-pay/v1/collect/initiate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Collect-Api-Key': 'cle-yelii-test' }),
        body: JSON.stringify({
          amount: 100,
          senderPhone: '657546880',
          channel: 'orange_money',
          callbackUrl: 'https://api.sgm-cem.test/webhooks/yelii',
        }),
      })
    )
  })

  it('traduit un refus applicatif HTTP 200 de Yelii', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, message: 'Solde insuffisant' }),
    })

    const result = await initiateYeliiPayment({ amount: 100, senderPhone: '657546880', channel: 'orange_money' })

    expect(result).toMatchObject({ success: false, transactionId: '', status: 'failed', code: 'YELII_PROVIDER_REJECTED' })
  })

  it('traduit un statut distant failed en refus de l’initialisation', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { transactionId: 'orange-refuse', status: 'failed' } }),
    })

    const result = await initiateYeliiPayment({ amount: 100, senderPhone: '657546880', channel: 'orange_money' })

    expect(result).toMatchObject({
      success: false,
      transactionId: 'orange-refuse',
      status: 'failed',
      code: 'YELII_PROVIDER_REJECTED',
    })
  })

  it('bloque une URL Yelii non autorisée avant tout appel réseau', async () => {
    process.env.YELII_BASE_URL = 'https://relay.yelii.test/api/v1'
    __clearConfigCacheForTests()

    const result = await initiateYeliiPayment({ amount: 100, senderPhone: '657546880', channel: 'orange_money' })

    expect(fetch).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: false, transactionId: '', status: 'failed', code: 'YELII_CONFIGURATION_INVALID' })
  })

  it('signale l’indisponibilité de Yelii sur une réponse HTTP non réussie', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 502, json: async () => ({}) })

    const result = await initiateYeliiPayment({ amount: 100, senderPhone: '657546880', channel: 'orange_money' })

    expect(result).toMatchObject({ success: false, transactionId: '', status: 'failed', code: 'YELII_UNAVAILABLE' })
  })

  it('rejette une réponse réussie sans référence de transaction', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { status: 'processing' } }),
    })

    const result = await initiateYeliiPayment({ amount: 100, senderPhone: '657546880', channel: 'orange_money' })

    expect(result).toMatchObject({ success: false, transactionId: '', status: 'failed', code: 'YELII_INVALID_RESPONSE' })
  })

  it('retourne la référence et le montant net après une initialisation réussie', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { transactionId: 'orange-100', status: 'pending', netCredited: 97 },
      }),
    })

    const result = await initiateYeliiPayment({ amount: 100, senderPhone: '657546880', channel: 'orange_money' })

    expect(result).toEqual({
      success: true,
      transactionId: 'orange-100',
      status: 'processing',
      netAmount: 97,
    })
  })
})
