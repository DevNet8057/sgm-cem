// Phase 4.1 — remboursements à double validation (décision du Bureau) :
// demande du trésorier, visa d'un administrateur ou d'un responsable,
// exécution hors application avec preuve obligatoire ; total ou partiel ;
// la contribution reste intacte, les totaux sont nets des remboursements.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { positionAt } from '../src/services/fund-ledger.service'
import { refundsByLocation } from '../src/services/refund.service'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `rmb-${Date.now()}`
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')
type Person = { id: string; email: string; role: string }
let tresorier: Person, admin: Person, responsable: Person, collecteur: Person, membre: Person
let rubriqueId = ''
let contributionId = ''
let refundId = ''

async function person(tag: string, role: string): Promise<Person> {
  const u = await prisma.user.create({
    data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'T', fullName: `${tag} T`, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: role as never, mustChangePassword: false },
  })
  return { id: u.id, email: u.email, role }
}

async function session(p: Person) {
  const cookie = await testCookie({ userId: p.id, role: p.role, email: p.email })
  const res = await request(app).get('/api/csrf-token').set('Cookie', cookie)
  const csrf = (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]
  return { cookie: `${cookie}; ${csrf}`, token: res.body.token as string }
}

async function call(p: Person, method: 'get' | 'post' | 'patch', path: string, body?: Record<string, unknown>) {
  const s = await session(p)
  const r = request(app)[method](path).set('Cookie', s.cookie).set('x-csrf-token', s.token)
  return body ? r.send(body) : r
}

async function execute(p: Person, id: string, withProof = true) {
  const s = await session(p)
  const r = request(app).patch(`/api/refunds/${id}/execute`).set('Cookie', s.cookie).set('x-csrf-token', s.token)
    .field('sourceLocation', 'EN_CAISSE').field('reference', 'Reçu n° 42')
  return withProof ? r.attach('proof', PDF, { filename: 'recu.pdf', contentType: 'application/pdf' }) : r
}

const ask = (montant: number) => call(tresorier, 'post', '/api/refunds', { contributionId, montant, moyen: 'ESPECES', motif: 'Trop-perçu sur la cotisation de mars', beneficiaire: 'mem T' })

beforeAll(async () => {
  tresorier = await person('tres', 'TRESORIER')
  admin = await person('adm', 'ADMIN')
  responsable = await person('resp', 'RESPONSABLE')
  collecteur = await person('col', 'COLLECTEUR')
  membre = await person('mem', 'MEMBRE')
  const m = await prisma.membre.create({ data: { userId: membre.id, memberId: `${RUN}-mm`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })
  rubriqueId = (await prisma.rubrique.create({
    data: { code: `${RUN}-R`, title: 'Rubrique remboursement', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), status: 'OUVERTE', createdById: tresorier.id, createdByName: 'T' },
  })).id
  contributionId = (await prisma.contribution.create({
    data: { membreId: m.id, rubriqueId, montant: 10000, modePaiement: 'ESPECES', statut: 'CONFIRME', localisationFonds: 'EN_CAISSE', collecteurId: collecteur.id },
  })).id
  await prisma.contribution.create({ data: { membreId: m.id, rubriqueId, montant: 3000, modePaiement: 'ESPECES', statut: 'EN_ATTENTE_CONFIRMATION' } })
})

describe('Remboursements', () => {
  it('seul le trésorier demande, et seulement sur une contribution confirmée, dans la limite du montant', async () => {
    expect((await call(admin, 'post', '/api/refunds', { contributionId, montant: 1000, moyen: 'ESPECES', motif: 'Trop-perçu sur la cotisation' })).status).toBe(403)
    expect((await ask(12000)).status).toBe(400)
    const pending = await prisma.contribution.findFirstOrThrow({ where: { rubriqueId, statut: 'EN_ATTENTE_CONFIRMATION' } })
    expect((await call(tresorier, 'post', '/api/refunds', { contributionId: pending.id, montant: 1000, moyen: 'ESPECES', motif: 'Trop-perçu sur la cotisation' })).status).toBe(400)
  })

  it('demande partielle : viseurs notifiés, montant réservé', async () => {
    const res = await ask(4000)
    expect(res.status).toBe(201)
    refundId = res.body.data.id
    expect(res.body.data.statut).toBe('DEMANDE')
    expect(await prisma.notification.count({ where: { userId: responsable.id, title: 'Remboursement à viser' } })).toBe(1)
    // 6 000 restent remboursables
    expect((await ask(6500)).status).toBe(400)
  })

  it('exécution impossible avant le visa ; le trésorier ne vise pas lui-même', async () => {
    expect((await execute(tresorier, refundId)).status).toBe(400)
    expect((await call(tresorier, 'patch', `/api/refunds/${refundId}/validate`)).status).toBe(403)
    expect((await call(collecteur, 'patch', `/api/refunds/${refundId}/validate`)).status).toBe(403)
  })

  it('visa d\'un responsable puis exécution avec preuve obligatoire', async () => {
    const v = await call(responsable, 'patch', `/api/refunds/${refundId}/validate`)
    expect(v.status).toBe(200)
    expect(v.body.data).toMatchObject({ statut: 'VALIDE', validatedById: responsable.id })
    expect((await call(admin, 'patch', `/api/refunds/${refundId}/validate`)).status).toBe(409)
    expect((await execute(tresorier, refundId, false)).status).toBe(400)
    const before = await positionAt(prisma, new Date())
    const ex = await execute(tresorier, refundId)
    expect(ex.status).toBe(200)
    expect(ex.body.data).toMatchObject({ statut: 'EXECUTE', sourceLocation: 'EN_CAISSE', hasProof: true })
    const after = await positionAt(prisma, new Date())
    expect(before.total - after.total).toBe(4000)
    expect((await refundsByLocation(prisma)).get('EN_CAISSE')).toBeGreaterThanOrEqual(4000)
    expect(await prisma.notification.count({ where: { userId: membre.id, title: 'Remboursement effectué' } })).toBe(1)
  })

  it('la contribution n\'est pas modifiée ; les totaux sont nets', async () => {
    const c = await prisma.contribution.findUniqueOrThrow({ where: { id: contributionId } })
    expect(c).toMatchObject({ montant: 10000, statut: 'CONFIRME' })
    const rubriques = await call(tresorier, 'get', '/api/rubriques')
    expect(rubriques.body.data.find((r: { id: string }) => r.id === rubriqueId).totalCollecte).toBe(6000)
    const summary = await call(membre, 'get', '/api/contributions/me/summary')
    expect(summary.body.data.confirmedAmount).toBe(6000)
  })

  it('preuve consultable par les viseurs ; refus motivé et annulation', async () => {
    const proof = await call(responsable, 'get', `/api/refunds/${refundId}/proof`)
    expect(proof.status).toBe(200)
    expect(proof.headers['content-type']).toContain('application/pdf')
    expect((await call(collecteur, 'get', `/api/refunds/${refundId}/proof`)).status).toBe(403)

    const second = (await ask(2000)).body.data.id
    expect((await call(admin, 'patch', `/api/refunds/${second}/reject`, { reason: 'court' })).status).toBe(400)
    const rej = await call(admin, 'patch', `/api/refunds/${second}/reject`, { reason: 'Pas de trop-perçu constaté au relevé' })
    expect(rej.body.data.statut).toBe('REJETE')
    const third = (await ask(6000)).body.data.id
    expect((await call(tresorier, 'patch', `/api/refunds/${third}/cancel`)).body.data.statut).toBe('ANNULE')
    // Rejetés et annulés libèrent le montant : 6 000 de nouveau demandables
    expect((await ask(6000)).status).toBe(201)
    const list = await call(responsable, 'get', '/api/refunds?statut=EXECUTE')
    expect(list.body.data.some((r: { id: string; hasProof: boolean }) => r.id === refundId && r.hasProof)).toBe(true)
    const logs = await prisma.auditLog.count({ where: { entityType: 'Remboursement', entityId: refundId } })
    expect(logs).toBe(3)
  })
})
