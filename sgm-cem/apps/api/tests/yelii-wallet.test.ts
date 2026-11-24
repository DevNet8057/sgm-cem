import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/services/config.service', () => ({
  getConfig: vi.fn((key: string) => ({
    NODE_ENV: 'production',
    API_URL: 'https://app.example.invalid',
    YELII_BASE_URL: 'https://api.yelii.xyz/api/yelii-pro-pay/v1',
    YELII_COLLECT_API_KEY: 'unit-test-placeholder-key',
    YELII_WEBHOOK_URL: 'https://app.example.invalid/webhooks/yelii',
  } as Record<string, string>)[key]),
}))

import { getYeliiWalletBalance } from '../src/services/yelii.service'

// Donnees inventees : aucun montant, identifiant ou secret marchand reel.
describe('Lecture seule du wallet Yelii', () => {
  let fetchMock: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchMock = vi.spyOn(globalThis, 'fetch')
  })
  afterEach(() => vi.restoreAllMocks())

  it.each([
    [{ success: true, data: { collectWallet: 1400 } }, 1400],
    [{ success: true, data: { collectWallet: '1400.50' } }, 1400.5],
    [{ success: true, data: { collectWallet: 0 } }, 0],
    [{ success: true, data: { collectWallet: ' 0 ' } }, 0],
    [{ data: { balance: 80 } }, 80],
    [{ balance: 55 }, 55],
  ])('reconnait le solde fournisseur ou historique %#', async (payload, balance) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))
    expect(await getYeliiWalletBalance()).toEqual({ ok: true, balance })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.yelii.xyz/api/yelii-pro-pay/v1/wallet/balance')
    expect((options as RequestInit | undefined)?.method ?? 'GET').toBe('GET')
  })

  it.each([
    null,
    {},
    { data: {} },
    { data: { collectWallet: null } },
    { data: { collectWallet: '' } },
    { data: { collectWallet: '   ' } },
    { data: { collectWallet: 'inconnu' } },
    { data: { collectWallet: 'Infinity' } },
    { data: { collectWallet: '0x20' } },
    { data: { collectWallet: true } },
    { data: { collectWallet: {} } },
    { success: false, data: { collectWallet: 1400 } },
  ])('refuse une reponse invalide au lieu de fabriquer un solde nul %#', async payload => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }))
    const result = await getYeliiWalletBalance()
    expect(result.ok).toBe(false)
    expect(result).not.toHaveProperty('balance')
  })

  it('conserve le refus HTTP authentification sans autre appel', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
    expect(await getYeliiWalletBalance()).toMatchObject({ ok: false, message: 'Yelii a r\u00e9pondu HTTP 401' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
