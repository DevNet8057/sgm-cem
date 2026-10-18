// Point important n° 10 : file des envois — état enregistré, nouveaux essais
// (1, 5, 30 min, 4 au plus), pas de nouvel essai d'un code expiré, rien à
// réessayer sans canal réglé. Fournisseur simulé : aucun envoi réel.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import axios from 'axios'
import { getPrisma } from '../src/lib/prisma'
import { deliverMessage, runOutboxRetries } from '../src/services/outbox.service'

const prisma = getPrisma()
const RUN = `env-${Date.now()}`
const MIN = 60_000

afterEach(() => { vi.restoreAllMocks(); delete process.env.DIALOG360_API_KEY })

async function lastEnvoi(objet: string) {
  return prisma.envoi.findFirstOrThrow({ where: { objet }, orderBy: { createdAt: 'desc' } })
}

beforeAll(() => { delete process.env.DIALOG360_API_KEY })

describe('File des envois', () => {
  it('sans canal réglé : enregistré « non configuré », jamais réessayé', async () => {
    expect(await deliverMessage(`${RUN}-a`, '677000001', { text: 'Bonjour' })).toBe(false)
    expect(await lastEnvoi(`${RUN}-a`)).toMatchObject({ statut: 'NON_CONFIGURE', essais: 0, prochainEssai: null })
  })

  it('échec puis nouvel essai réussi : état ENVOYE, voie WhatsApp, 2 essais', async () => {
    process.env.DIALOG360_API_KEY = 'cle-de-test'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const post = vi.spyOn(axios, 'post').mockRejectedValueOnce(new Error('réseau coupé')).mockResolvedValue({ data: {} })
    expect(await deliverMessage(`${RUN}-b`, '677000002', { text: 'Reçu' })).toBe(false)
    const pending = await lastEnvoi(`${RUN}-b`)
    expect(pending).toMatchObject({ statut: 'EN_ATTENTE', essais: 1 })
    expect(pending.prochainEssai!.getTime() - pending.updatedAt.getTime()).toBeGreaterThanOrEqual(MIN - 1000)
    await runOutboxRetries(new Date(Date.now() + 2 * MIN))
    expect(await lastEnvoi(`${RUN}-b`)).toMatchObject({ statut: 'ENVOYE', voie: 'WHATSAPP', essais: 2 })
    // D'autres envois en attente peuvent passer dans la même relance : on compte ceux de ce numéro
    expect(post.mock.calls.filter(c => (c[1] as { to?: string }).to === '237677000002')).toHaveLength(2)
  })

  it('4 échecs : abandon (ECHEC) avec la dernière erreur', async () => {
    process.env.DIALOG360_API_KEY = 'cle-de-test'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('réseau coupé'))
    await deliverMessage(`${RUN}-c`, '677000003', { text: 'Relevé' })
    for (const minutes of [2, 10, 60]) await runOutboxRetries(new Date(Date.now() + minutes * MIN))
    expect(await lastEnvoi(`${RUN}-c`)).toMatchObject({ statut: 'ECHEC', essais: 4, derniereErreur: 'WhatsApp et SMS en échec' })
  })

  it('code de connexion : pas de nouvel essai après sa validité', async () => {
    process.env.DIALOG360_API_KEY = 'cle-de-test'
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('réseau coupé'))
    await deliverMessage(`${RUN}-d`, '677000004', { text: 'Code 123456' }, { expiresAt: new Date(Date.now() + 30_000) })
    expect(await lastEnvoi(`${RUN}-d`)).toMatchObject({ statut: 'ECHEC', essais: 1 })
  })
})
