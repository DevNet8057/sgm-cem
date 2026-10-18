// Point important n° 13 : une demande Mobile Money restée sans réponse plus de
// 30 minutes ne bloque plus un nouvel essai ; dans la fenêtre, la même demande
// est rendue (anti double débit). Yelii simulé : aucun paiement réel.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import request from 'supertest'

let seq = 0
vi.mock('../src/services/payment-attempt.service', async (orig) => ({
  ...(await orig<typeof import('../src/services/payment-attempt.service')>()),
  initiateTrackedYeliiPayment: vi.fn(async () => ({ success: true, transactionId: `T-relance-${Date.now()}-${seq++}` })),
}))

import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `rel-${Date.now()}`
let user = { id: '', email: '' }
let membreId = ''
let rubriqueId = ''
let oldId = ''

async function initiate() {
  const cookie = await testCookie({ userId: user.id, role: 'MEMBRE', email: user.email })
  const csrf = await request(app).get('/api/csrf-token').set('Cookie', cookie)
  const c = (csrf.headers['set-cookie'] as unknown as string[]).find(x => x.startsWith('csrf_token='))!.split(';')[0]
  return request(app).post('/api/payments/initiate').set('Cookie', `${cookie}; ${c}`).set('x-csrf-token', csrf.body.token)
    .send({ membreId, rubriqueId, montant: 2000, modePaiement: 'YELII', mobileMoneyPhone: '677000099', paymentChannel: 'MTN' })
}

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { memberId: `${RUN}-u`, firstName: 'R', lastName: 'T', fullName: 'R T', email: `${RUN}@test.local`, passwordHash: 'disabled', role: 'MEMBRE', mustChangePassword: false },
  })
  user = { id: u.id, email: u.email }
  membreId = (await prisma.membre.create({ data: { userId: u.id, memberId: `${RUN}-m`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })).id
  rubriqueId = (await prisma.rubrique.create({
    data: { code: `${RUN}-R`, title: 'Rubrique relance', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), status: 'OUVERTE', createdById: u.id, createdByName: 'R T' },
  })).id
  // Demande d'il y a 2 h, jamais aboutie (webhook perdu, payeur n'a pas validé)
  oldId = (await prisma.contribution.create({
    data: { membreId, rubriqueId, montant: 2000, modePaiement: 'YELII', statut: 'EN_ATTENTE_CONFIRMATION', paymentStatus: 'PROCESSING', externalTransactionId: `T-old-${RUN}`, createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
  })).id
})

describe('Nouvel essai de paiement', () => {
  it('demande ancienne : un nouvel essai crée une nouvelle demande, l\'ancienne reste suivie', async () => {
    const res = await initiate()
    expect(res.status).toBe(200)
    expect(res.body.data.contributionId).not.toBe(oldId)
    expect(await prisma.contribution.findUniqueOrThrow({ where: { id: oldId } })).toMatchObject({ statut: 'EN_ATTENTE_CONFIRMATION', paymentStatus: 'PROCESSING' })
  })

  it('dans la fenêtre de 30 min : la même demande est rendue (pas de second débit)', async () => {
    const first = await prisma.contribution.findFirstOrThrow({ where: { membreId, id: { not: oldId } } })
    const again = await initiate()
    expect(again.status).toBe(200)
    expect(again.body.data.contributionId).toBe(first.id)
  })
})
