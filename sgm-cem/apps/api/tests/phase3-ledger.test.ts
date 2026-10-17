// Phase 3.3 — grand livre des fonds : chaque déplacement d'argent est écrit,
// le détenteur est distinct de l'auteur, un responsable peut remettre au
// trésorier, un refus rend les fonds à leur emplacement d'origine, et le dépôt
// en banque exige un reçu archivé (décision du Bureau du 17/10/2026).
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { checkLedger, positionAt, recordMovements } from '../src/services/fund-ledger.service'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `ldg-${Date.now()}`
type Person = { id: string; email: string; role: string }
let collecteur: Person, responsable: Person, tresorier: Person, autre: Person
let membreId = ''
let rubriqueId = ''
let cashId = ''
let virementId = ''
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')

async function person(tag: string, role: string): Promise<Person> {
  const u = await prisma.user.create({
    data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'T', fullName: `${tag} T`, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: role as never, mustChangePassword: false },
  })
  return { id: u.id, email: u.email, role }
}

async function session(p: Person) {
  const cookie = await testCookie({ userId: p.id, role: p.role, email: p.email })
  const res = await request(app).get('/api/csrf-token').set('Cookie', cookie)
  const csrfCookie = (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]
  return { cookie: `${cookie}; ${csrfCookie}`, token: res.body.token as string }
}

async function call(p: Person, method: 'post' | 'patch' | 'get', path: string, body?: Record<string, unknown>) {
  const s = await session(p)
  const r = request(app)[method](path).set('Cookie', s.cookie).set('x-csrf-token', s.token)
  return body ? r.send(body) : r
}

async function state(id: string) {
  return prisma.contribution.findUniqueOrThrow({ where: { id }, select: { localisationFonds: true, detenteurId: true, collecteurId: true, statut: true } })
}

async function transferAndAnswer(from: Person, to: Person, ids: string[], answer: 'confirm' | 'refuse') {
  const sent = await call(from, 'post', '/api/funds/transfer', { receiverId: to.id, contributionIds: ids, transferType: 'ESPECES_EN_MAIN' })
  expect(sent.status).toBe(200)
  const path = `/api/funds/transfers/${sent.body.data.id}/${answer}`
  const res = await call(to, 'patch', path, answer === 'refuse' ? { reason: 'Montant compté différent du bordereau' } : {})
  expect(res.status).toBe(200)
}

beforeAll(async () => {
  collecteur = await person('col', 'COLLECTEUR')
  responsable = await person('resp', 'RESPONSABLE')
  tresorier = await person('tres', 'TRESORIER')
  autre = await person('autre', 'COLLECTEUR')
  const m = await person('mem', 'MEMBRE')
  membreId = (await prisma.membre.create({ data: { userId: m.id, memberId: `${RUN}-mm`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })).id
  rubriqueId = (await prisma.rubrique.create({
    data: { code: `${RUN}-R`, title: 'Rubrique grand livre', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), status: 'OUVERTE', createdById: tresorier.id, createdByName: 'T' },
  })).id
})

describe('Grand livre des fonds', () => {
  it('un encaissement en main entre chez le collecteur, qui en est détenteur', async () => {
    const res = await call(collecteur, 'post', '/api/contributions', { membreId, rubriqueId, montant: 5000, modePaiement: 'ESPECES', directCollection: true })
    expect(res.status).toBe(201)
    cashId = res.body.data.id
    expect(await state(cashId)).toMatchObject({ statut: 'CONFIRME', localisationFonds: 'CHEZ_COLLECTEUR', detenteurId: collecteur.id })
  })

  it('un virement confirmé est chez le trésorier (décision du Bureau)', async () => {
    const created = await call(collecteur, 'post', '/api/contributions', { membreId, rubriqueId, montant: 3000, modePaiement: 'VIREMENT' })
    virementId = created.body.data.id
    const res = await call(collecteur, 'patch', `/api/contributions/${virementId}/confirm`, {})
    expect(res.status).toBe(200)
    expect(await state(virementId)).toMatchObject({ localisationFonds: 'REMIS_TRESORIER', detenteurId: null })
  })

  it('collecteur → responsable : le détenteur change, l\'auteur reste', async () => {
    await transferAndAnswer(collecteur, responsable, [cashId], 'confirm')
    expect(await state(cashId)).toMatchObject({ localisationFonds: 'CHEZ_RESPONSABLE', detenteurId: responsable.id, collecteurId: collecteur.id })
  })

  it('l\'ancien détenteur ne peut plus remettre ces fonds', async () => {
    const res = await call(collecteur, 'post', '/api/funds/transfer', { receiverId: tresorier.id, contributionIds: [cashId] })
    expect(res.status).toBe(403)
    const tiers = await call(autre, 'post', '/api/funds/transfer', { receiverId: tresorier.id, contributionIds: [cashId] })
    expect(tiers.status).toBe(403)
  })

  it('responsable → trésorier refusé : les fonds reviennent chez le responsable', async () => {
    await transferAndAnswer(responsable, tresorier, [cashId], 'refuse')
    expect(await state(cashId)).toMatchObject({ localisationFonds: 'CHEZ_RESPONSABLE', detenteurId: responsable.id })
  })

  it('responsable → trésorier confirmé : fonds chez le trésorier', async () => {
    await transferAndAnswer(responsable, tresorier, [cashId], 'confirm')
    expect(await state(cashId)).toMatchObject({ localisationFonds: 'REMIS_TRESORIER', detenteurId: tresorier.id })
  })

  it('dépôt en banque refusé sans reçu, ou avec un faux reçu', async () => {
    const s = await session(tresorier)
    const sans = await request(app).patch('/api/funds/bank-deposit').set('Cookie', s.cookie).set('x-csrf-token', s.token)
      .field('contributionIds', JSON.stringify([cashId, virementId])).field('referenceBordereau', `${RUN}-BRD`)
    expect(sans.status).toBe(400)
    const faux = await request(app).patch('/api/funds/bank-deposit').set('Cookie', s.cookie).set('x-csrf-token', s.token)
      .field('contributionIds', JSON.stringify([cashId, virementId])).field('referenceBordereau', `${RUN}-BRD`)
      .attach('proof', Buffer.from('<html>pas un reçu</html>'), { filename: 'recu.pdf', contentType: 'application/pdf' })
    expect(faux.status).toBe(400)
    expect((await state(cashId)).localisationFonds).toBe('REMIS_TRESORIER')
  })

  it('dépôt en banque avec reçu : fonds en banque, reçu archivé et consultable', async () => {
    const s = await session(tresorier)
    const res = await request(app).patch('/api/funds/bank-deposit').set('Cookie', s.cookie).set('x-csrf-token', s.token)
      .field('contributionIds', JSON.stringify([cashId, virementId])).field('referenceBordereau', `${RUN}-BRD`)
      .attach('proof', PDF, { filename: 'recu-depot.pdf', contentType: 'application/pdf' })
    expect(res.status).toBe(200)
    expect(res.body.data.totalAmount).toBe(8000)
    expect(await state(cashId)).toMatchObject({ localisationFonds: 'EN_BANQUE', detenteurId: null })

    const list = await call(tresorier, 'get', '/api/funds/bank-deposits')
    const deposit = list.body.data.find((d: { id: string }) => d.id === res.body.data.id)
    expect(deposit.hasProof).toBe(true)
    expect(deposit.proofKey).toBeUndefined()

    const proof = await request(app).get(`/api/funds/bank-deposits/${res.body.data.id}/proof`).set('Cookie', s.cookie).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = []
      r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(proof.status).toBe(200)
    expect(proof.headers['content-type']).toBe('application/pdf')
    expect(Buffer.compare(proof.body as Buffer, PDF)).toBe(0)

    const collector = await call(collecteur, 'get', `/api/funds/bank-deposits/${res.body.data.id}/proof`)
    expect(collector.status).toBe(403)
  })

  it('le grand livre retrace tout le parcours, sans écart avec l\'état actuel', async () => {
    const moves = await prisma.fundMovement.findMany({ where: { contributionId: cashId }, orderBy: [{ at: 'asc' }, { id: 'asc' }] })
    expect(moves.map(m => m.reason)).toEqual([
      'CONFIRMATION', 'TRANSFERT_ENVOI', 'TRANSFERT_RECEPTION', 'TRANSFERT_ENVOI', 'TRANSFERT_REFUS', 'TRANSFERT_ENVOI', 'TRANSFERT_RECEPTION', 'DEPOT_BANCAIRE',
    ])
    const check = await checkLedger(prisma)
    expect(check.mismatches.filter(m => [cashId, virementId].includes(m.contributionId))).toEqual([])
  })

  it('position à date : avant la mise en service, signalée comme telle', async () => {
    const now = await positionAt(prisma, new Date())
    expect(now.byLocation.find(l => l.location === 'EN_BANQUE')!.amount).toBeGreaterThanOrEqual(8000)
    const before = await positionAt(prisma, new Date('2000-01-01'))
    expect(before.beforeLedgerStart).toBe(true)
    expect(before.total).toBe(0)
    const api = await call(tresorier, 'get', '/api/funds/position?date=2000-01-01')
    expect(api.status).toBe(200)
    expect(api.body.data.beforeLedgerStart).toBe(true)
  })

  it('une transition hors règles est refusée', async () => {
    await expect(prisma.$transaction(tx => recordMovements(tx, [{ contributionId: cashId, montant: 1, from: 'EN_BANQUE', to: 'CHEZ_COLLECTEUR', reason: 'TRANSFERT_RECEPTION' }])))
      .rejects.toThrow(/interdit/)
  })
})
