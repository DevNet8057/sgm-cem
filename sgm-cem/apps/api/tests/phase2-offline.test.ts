// Phase 2.8 — saisie hors ligne rejouée : une même clé d'envoi ne crée
// jamais deux contributions, et la clé d'un autre auteur est refusée.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'crypto'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `off-${Date.now()}`
let collecteur = { id: '', email: '' }
let autre = { id: '', email: '' }
let membreId = ''
let rubriqueId = ''

async function staff(tag: string) {
  return prisma.user.create({
    data: { memberId: `${RUN}-${tag}`, firstName: 'C', lastName: tag, fullName: `C ${tag}`, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: 'COLLECTEUR', mustChangePassword: false },
  })
}

async function session(user: { id: string; email: string }) {
  const cookie = await testCookie({ userId: user.id, role: 'COLLECTEUR', email: user.email })
  const res = await request(app).get('/api/csrf-token').set('Cookie', cookie)
  const csrfCookie = (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]
  return { cookie: `${cookie}; ${csrfCookie}`, token: res.body.token as string }
}

async function post(user: { id: string; email: string }, body: Record<string, unknown>) {
  const s = await session(user)
  return request(app).post('/api/contributions').set('Cookie', s.cookie).set('x-csrf-token', s.token).send(body)
}

beforeAll(async () => {
  const a = await staff('a')
  const b = await staff('b')
  collecteur = { id: a.id, email: a.email }
  autre = { id: b.id, email: b.email }
  const m = await prisma.user.create({
    data: { memberId: `${RUN}-m`, firstName: 'M', lastName: 'm', fullName: 'M m', email: `${RUN}-m@test.local`, passwordHash: 'disabled', role: 'MEMBRE', mustChangePassword: false },
  })
  membreId = (await prisma.membre.create({ data: { userId: m.id, memberId: `${RUN}-mm`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })).id
  rubriqueId = (await prisma.rubrique.create({
    data: { code: `${RUN}-R`, title: 'Rubrique hors ligne', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), status: 'OUVERTE', createdById: a.id, createdByName: 'T' },
  })).id
})

describe('Saisie hors ligne idempotente', () => {
  it('un envoi rejoué renvoie la contribution existante sans doublon', async () => {
    const clientRequestId = randomUUID()
    const body = { membreId, rubriqueId, montant: 1500, modePaiement: 'ESPECES', directCollection: true, clientRequestId }
    const first = await post(collecteur, body)
    expect(first.status).toBe(201)
    const replay = await post(collecteur, body)
    expect(replay.status).toBe(200)
    expect(replay.body.data.id).toBe(first.body.data.id)
    expect(replay.body.data.replayed).toBe(true)
    expect(await prisma.contribution.count({ where: { clientRequestId } })).toBe(1)
  })

  it('la clé d\'un autre auteur est refusée', async () => {
    const clientRequestId = randomUUID()
    const body = { membreId, rubriqueId, montant: 700, modePaiement: 'ESPECES', clientRequestId }
    expect((await post(collecteur, body)).status).toBe(201)
    const res = await post(autre, body)
    expect(res.status).toBe(409)
  })

  it('sans clé, le comportement historique est inchangé', async () => {
    const res = await post(collecteur, { membreId, rubriqueId, montant: 300, modePaiement: 'ESPECES' })
    expect(res.status).toBe(201)
  })
})
