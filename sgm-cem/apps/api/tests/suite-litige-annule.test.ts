// Reste à faire n° 1 (EF-M06-05, EF-M16-01) : une contribution confirmée mise en
// litige puis annulée sort du grand livre ; la position et le contrôle quotidien
// en tiennent compte ; pas de litige sur une contribution déjà en remboursement.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { checkLedger, isTransitionAllowed, positionAt } from '../src/services/fund-ledger.service'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `lit-${Date.now()}`
type Person = { id: string; email: string; role: string }
let collecteur: Person, responsable: Person, tresorier: Person
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

async function cash(montant: number) {
  const res = await call(collecteur, 'post', '/api/contributions', { membreId, rubriqueId, montant, modePaiement: 'ESPECES', directCollection: true })
  expect(res.status).toBe(201)
  return res.body.data.id as string
}

const chezCollecteur = async () => (await positionAt(prisma, new Date())).byLocation.find(r => r.location === 'CHEZ_COLLECTEUR')?.amount ?? 0

beforeAll(async () => {
  collecteur = await person('col', 'COLLECTEUR')
  responsable = await person('resp', 'RESPONSABLE')
  tresorier = await person('tres', 'TRESORIER')
  const m = await person('mem', 'MEMBRE')
  membreId = (await prisma.membre.create({ data: { userId: m.id, memberId: `${RUN}-mm`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })).id
  rubriqueId = (await prisma.rubrique.create({
    data: { code: `${RUN}-R`, title: 'Rubrique litige', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), status: 'OUVERTE', createdById: tresorier.id, createdByName: 'T' },
  })).id
})

describe('Litige annulé', () => {
  it('la sortie du circuit est réservée à l\'annulation d\'un litige', () => {
    expect(isTransitionAllowed('CHEZ_COLLECTEUR', 'HORS_CIRCUIT', 'ANNULATION_LITIGE')).toBe(true)
    expect(isTransitionAllowed('CHEZ_COLLECTEUR', 'HORS_CIRCUIT', 'TRANSFERT_ENVOI')).toBe(false)
    expect(isTransitionAllowed('EN_BANQUE', 'HORS_CIRCUIT', 'ANNULATION_LITIGE')).toBe(false)
    expect(isTransitionAllowed(null, 'HORS_CIRCUIT', 'ANNULATION_LITIGE')).toBe(false)
  })

  it('confirmée → litige → annulée : l\'argent sort de la position et le contrôle reste juste', async () => {
    const id = await cash(4000)
    const before = await chezCollecteur()
    expect((await call(responsable, 'patch', `/api/contributions/${id}/litige`, { motif: 'Le membre conteste avoir payé' })).status).toBe(200)
    // En litige, l'argent est toujours physiquement chez le collecteur
    expect(await chezCollecteur()).toBe(before)
    const res = await call(responsable, 'patch', `/api/contributions/${id}/resolve-litige`, { resolution: 'ANNULE', note: 'Billets rendus au membre' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ statut: 'ANNULE', localisationFonds: 'HORS_CIRCUIT', detenteurId: null })
    expect(await chezCollecteur()).toBe(before - 4000)
    const last = await prisma.fundMovement.findFirstOrThrow({ where: { contributionId: id }, orderBy: [{ at: 'desc' }, { id: 'desc' }] })
    expect(last).toMatchObject({ reason: 'ANNULATION_LITIGE', fromLocation: 'CHEZ_COLLECTEUR', toLocation: 'HORS_CIRCUIT', holderFromId: collecteur.id, actorId: responsable.id })
    expect((await checkLedger(prisma)).mismatches.map(m => m.contributionId)).not.toContain(id)
  })

  it('le contrôle quotidien signale une annulée restée dans le grand livre', async () => {
    const id = await cash(1500)
    // Ancien comportement simulé : statut changé sans écriture de sortie
    await prisma.contribution.update({ where: { id }, data: { statut: 'ANNULE' } })
    expect((await checkLedger(prisma)).mismatches.map(m => m.contributionId)).toContain(id)
  })

  it('pas de litige sur une contribution déjà en remboursement', async () => {
    const id = await cash(2000)
    const refund = await call(tresorier, 'post', '/api/refunds', { contributionId: id, montant: 1000, moyen: 'ESPECES', motif: 'Erreur de rubrique signalée' })
    expect(refund.status).toBe(201)
    const res = await call(responsable, 'patch', `/api/contributions/${id}/litige`, { motif: 'Le membre conteste avoir payé' })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/remboursement/)
  })
})
