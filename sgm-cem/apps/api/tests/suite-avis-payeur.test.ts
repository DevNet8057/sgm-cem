// Point important n° 9 (EF-M05-10, EF-M05-21, EF-M06-02) : le membre est prévenu
// d'une confirmation manuelle (avec reçu), d'un refus et d'une mise en litige.
// WhatsApp, SMS et e-mail ne sont pas réglés ici : seul l'avis dans l'application part.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `avis-${Date.now()}`
type Person = { id: string; email: string; role: string }
let collecteur: Person, responsable: Person, membre: Person
let membreId = ''
let rubriqueId = ''

async function person(tag: string, role: string): Promise<Person> {
  const u = await prisma.user.create({
    data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'T', fullName: `${tag} T`, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: role as never, mustChangePassword: false },
  })
  return { id: u.id, email: u.email, role }
}

async function call(p: Person, method: 'post' | 'patch', path: string, body: Record<string, unknown> = {}) {
  const cookie = await testCookie({ userId: p.id, role: p.role, email: p.email })
  const res = await request(app).get('/api/csrf-token').set('Cookie', cookie)
  const csrf = (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]
  return request(app)[method](path).set('Cookie', `${cookie}; ${csrf}`).set('x-csrf-token', res.body.token as string).send(body)
}

/** L'avis part sans bloquer la réponse : on l'attend quelques instants. */
async function noticeFor(contributionId: string, title: string) {
  for (let i = 0; i < 40; i++) {
    const n = await prisma.notification.findFirst({ where: { userId: membre.id, title, targetId: contributionId } })
    if (n) return n
    await new Promise(r => setTimeout(r, 100))
  }
  return null
}

beforeAll(async () => {
  collecteur = await person('col', 'COLLECTEUR')
  responsable = await person('resp', 'RESPONSABLE')
  membre = await person('mem', 'MEMBRE')
  membreId = (await prisma.membre.create({ data: { userId: membre.id, memberId: `${RUN}-mm`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })).id
  rubriqueId = (await prisma.rubrique.create({
    data: { code: `${RUN}-R`, title: 'Rubrique avis', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), status: 'OUVERTE', createdById: responsable.id, createdByName: 'R' },
  })).id
})

describe('Avis au membre', () => {
  it('espèces encaissées en main : le membre est prévenu', async () => {
    const res = await call(collecteur, 'post', '/api/contributions', { membreId, rubriqueId, montant: 3000, modePaiement: 'ESPECES', directCollection: true })
    expect(res.status).toBe(201)
    expect(await noticeFor(res.body.data.id, 'Paiement confirmé')).not.toBeNull()
  })

  it('déclaration confirmée par le collecteur : le membre est prévenu', async () => {
    const created = await call(collecteur, 'post', '/api/contributions', { membreId, rubriqueId, montant: 2000, modePaiement: 'VIREMENT' })
    expect((await call(collecteur, 'patch', `/api/contributions/${created.body.data.id}/confirm`)).status).toBe(200)
    expect(await noticeFor(created.body.data.id, 'Paiement confirmé')).not.toBeNull()
  })

  it('refus : le membre reçoit le motif', async () => {
    const created = await call(collecteur, 'post', '/api/contributions', { membreId, rubriqueId, montant: 1500, modePaiement: 'ESPECES' })
    expect((await call(collecteur, 'patch', `/api/contributions/${created.body.data.id}/refuse`, { motif: 'Aucun argent remis ce jour' })).status).toBe(200)
    const n = await noticeFor(created.body.data.id, 'Paiement non reçu')
    expect(n?.body).toMatch(/Aucun argent remis ce jour/)
  })

  it('mise en litige puis annulation : deux avis', async () => {
    const created = await call(collecteur, 'post', '/api/contributions', { membreId, rubriqueId, montant: 1000, modePaiement: 'ESPECES' })
    const id = created.body.data.id
    expect((await call(responsable, 'patch', `/api/contributions/${id}/litige`, { motif: 'Montant différent du reçu papier' })).status).toBe(200)
    expect(await noticeFor(id, 'Paiement en vérification')).not.toBeNull()
    expect((await call(responsable, 'patch', `/api/contributions/${id}/resolve-litige`, { resolution: 'ANNULE', note: 'Erreur de saisie' })).status).toBe(200)
    expect(await noticeFor(id, 'Paiement annulé après vérification')).not.toBeNull()
  })
})
