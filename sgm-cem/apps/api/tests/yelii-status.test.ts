import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { getYeliiStatus } from '../src/services/yelii.service'

// getYeliiStatus est appelée toutes les 5s par le polling de statut de
// paiement. Elle doit renvoyer 'unknown' (jamais 'failed') dès qu'on ne peut
// pas trancher — sinon une micro-coupure réseau ferait passer une
// contribution parfaitement valide en ANNULE.

const cleApiOriginale = process.env.YELII_COLLECT_API_KEY

beforeAll(() => {
  process.env.YELII_COLLECT_API_KEY = 'test-key'
})

afterAll(() => {
  // isolate:false + singleFork : sans restauration, la clé de test fuiterait
  // sur tous les fichiers de tests suivants du même run.
  if (cleApiOriginale === undefined) delete process.env.YELII_COLLECT_API_KEY
  else process.env.YELII_COLLECT_API_KEY = cleApiOriginale
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getYeliiStatus — statut distant Yelii', () => {
  it('renvoie "unknown" (jamais "failed") en cas d\'erreur réseau', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'))

    const status = await getYeliiStatus('tx-1')

    // Assertion clé : une simple coupure réseau ne doit JAMAIS être
    // interprétée comme un paiement échoué (bug corrigé).
    expect(status).toBe('unknown')
    expect(status).not.toBe('failed')
  })

  it('renvoie "unknown" sur une réponse HTTP 500', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    })

    const status = await getYeliiStatus('tx-2')

    expect(status).toBe('unknown')
  })

  it('renvoie "unknown" sur une réponse HTTP 404', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    })

    const status = await getYeliiStatus('tx-3')

    expect(status).toBe('unknown')
  })

  it('renvoie "success" quand le statut distant est "completed"', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'completed' }),
    })

    const status = await getYeliiStatus('tx-4')

    expect(status).toBe('success')
  })

  it('renvoie "failed" quand le statut distant est "cancelled"', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'cancelled' }),
    })

    const status = await getYeliiStatus('tx-5')

    expect(status).toBe('failed')
  })

  it('renvoie "processing" quand le statut distant est "pending"', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'pending' }),
    })

    const status = await getYeliiStatus('tx-6')

    expect(status).toBe('processing')
  })

  it('renvoie "unknown" si le corps de la réponse est illisible', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('boom')
      },
    })

    const status = await getYeliiStatus('tx-7')

    expect(status).toBe('unknown')
  })
})
