// Phase 4.4 — autorisation de substitution (EF-M06-06, RG-15) : un trésorier ne
// confirme le paiement d'un autre collecteur qu'avec une autorisation nominative
// d'un administrateur, à échéance, à usage unique, révocable et journalisée.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `sub-${Date.now()}`
type Person = { id: string; email: string; role: string }
let collecteur: Person, tresorier: Person, tresorier2: Person, admin: Person, admin2: Person
let membreId = ''
let rubriqueId = ''

async function person(tag: string, role: string): Promise<Person> {
  const u = await prisma.user.create({
    data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'T', fullName: `${tag} T`, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: role as never, mustChangePassword: false },
  })
  return { id: u.id, email: u.email, role }
}

async function call(p: Person, method: 'post' | 'patch' | 'get' | 'delete', path: string, body?: Record<string, unknown>) {
  const cookie = await testCookie({ userId: p.id, role: p.role, email: p.email })
  const res = await request(app).get('/api/csrf-token').set('Cookie', cookie)
  const csrf = (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]
  const r = request(app)[method](path).set('Cookie', `${cookie}; ${csrf}`).set('x-csrf-token', res.body.token as string)
  return body ? r.send(body) : r
}

async function pending(statut: 'EN_ATTENTE_CONFIRMATION' | 'LITIGE' = 'EN_ATTENTE_CONFIRMATION') {
  return (await prisma.contribution.create({
    data: { membreId, rubriqueId, collecteurId: collecteur.id, montant: 2000, modePaiement: 'ESPECES', statut },
  })).id
}

const grant = (id: string, treasurerId = tresorier.id, by = admin) =>
  call(by, 'post', `/api/contributions/${id}/confirmation-authorization`, { treasurerId, motif: 'Collecteur absent pour deuil familial', dureeHeures: 24 })

async function canConfirmInList(p: Person, id: string): Promise<boolean | undefined> {
  // Liste filtrée sur la rubrique du test (la base de test partagée contient d'autres attentes)
  const res = await call(p, 'get', `/api/contributions?rubriqueId=${rubriqueId}&limit=100`)
  return (res.body.data as Array<{ id: string; actions: { canConfirm: boolean } }>).find(c => c.id === id)?.actions.canConfirm
}

beforeAll(async () => {
  collecteur = await person('col', 'COLLECTEUR')
  tresorier = await person('tres', 'TRESORIER')
  tresorier2 = await person('tres2', 'TRESORIER')
  admin = await person('adm', 'ADMIN')
  admin2 = await person('adm2', 'ADMIN')
  const m = await person('mem', 'MEMBRE')
  membreId = (await prisma.membre.create({ data: { userId: m.id, memberId: `${RUN}-mm`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })).id
  rubriqueId = (await prisma.rubrique.create({
    data: { code: `${RUN}-R`, title: 'Rubrique substitution', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), status: 'OUVERTE', createdById: admin.id, createdByName: 'A' },
  })).id
})

describe('Autorisation de substitution', () => {
  it('sans autorisation, le trésorier ne confirme pas le paiement d\'un autre collecteur', async () => {
    const id = await pending()
    expect(await canConfirmInList(tresorier, id)).toBe(false)
    expect((await call(tresorier, 'patch', `/api/contributions/${id}/confirm`)).status).toBe(403)
  })

  it('seul un administrateur accorde, à un trésorier actif seulement', async () => {
    const id = await pending()
    expect((await grant(id, tresorier.id, tresorier)).status).toBe(403)
    expect((await grant(id, collecteur.id)).status).toBe(400)
    const ok = await grant(id)
    expect(ok.status).toBe(201)
    expect(ok.body.data.confirmationAuthorization).toMatchObject({ treasurerId: tresorier.id, grantedById: admin.id })
    const n = await prisma.notification.findFirst({ where: { userId: tresorier.id, title: 'Confirmation autorisée' } })
    expect(n?.targetId).toBe(id)
  })

  it('autorisation nominative, consommée à l\'usage et journalisée', async () => {
    const id = await pending()
    await grant(id)
    expect(await canConfirmInList(tresorier, id)).toBe(true)
    expect(await canConfirmInList(tresorier2, id)).toBe(false)
    expect((await call(tresorier2, 'patch', `/api/contributions/${id}/confirm`)).status).toBe(403)

    const res = await call(tresorier, 'patch', `/api/contributions/${id}/confirm`)
    expect(res.status).toBe(200)
    const c = await prisma.contribution.findUniqueOrThrow({ where: { id } })
    expect(c.statut).toBe('CONFIRME')
    expect((c.confirmationAuthorization as { consumedAt?: string }).consumedAt).toBeTruthy()
    const log = await prisma.auditLog.findFirst({ where: { entityId: id, action: 'CONFIRM_OVERRIDE' } })
    expect(log?.userId).toBe(tresorier.id)
    expect(log?.details).toMatchObject({ designatedCollecteurId: collecteur.id, autorisation: { grantedById: admin.id } })
    // Déjà utilisée : plus révocable
    expect((await call(admin, 'delete', `/api/contributions/${id}/confirmation-authorization`)).status).toBe(400)
  })

  it('révocation : l\'autorisation ne sert plus', async () => {
    const id = await pending()
    await grant(id)
    const rev = await call(admin, 'delete', `/api/contributions/${id}/confirmation-authorization`)
    expect(rev.status).toBe(200)
    expect(await canConfirmInList(tresorier, id)).toBe(false)
    expect((await call(tresorier, 'patch', `/api/contributions/${id}/confirm`)).status).toBe(403)
    expect(await prisma.auditLog.count({ where: { entityId: id, entityType: 'AutorisationConfirmation' } })).toBe(2)
  })

  it('échéance dépassée : refus', async () => {
    const id = await pending()
    await grant(id)
    const c = await prisma.contribution.findUniqueOrThrow({ where: { id } })
    await prisma.contribution.update({ where: { id }, data: { confirmationAuthorization: { ...(c.confirmationAuthorization as object), expiresAt: new Date(Date.now() - 1000).toISOString() } } })
    expect((await call(tresorier, 'patch', `/api/contributions/${id}/confirm`)).status).toBe(403)
  })

  it('administrateur désactivé : son autorisation est sans effet', async () => {
    const id = await pending()
    expect((await grant(id, tresorier.id, admin2)).status).toBe(201)
    await prisma.user.update({ where: { id: admin2.id }, data: { isActive: false } })
    expect(await canConfirmInList(tresorier, id)).toBe(false)
    expect((await call(tresorier, 'patch', `/api/contributions/${id}/confirm`)).status).toBe(403)
  })

  it('litige : résolution en « confirmée » avec autorisation', async () => {
    const id = await pending('LITIGE')
    expect((await call(tresorier, 'patch', `/api/contributions/${id}/resolve-litige`, { resolution: 'CONFIRME' })).status).toBe(403)
    await grant(id)
    const res = await call(tresorier, 'patch', `/api/contributions/${id}/resolve-litige`, { resolution: 'CONFIRME', note: 'Collecteur joint par téléphone' })
    expect(res.status).toBe(200)
    const c = await prisma.contribution.findUniqueOrThrow({ where: { id } })
    expect(c.statut).toBe('CONFIRME')
    expect((c.confirmationAuthorization as { consumedAt?: string }).consumedAt).toBeTruthy()
  })
})
