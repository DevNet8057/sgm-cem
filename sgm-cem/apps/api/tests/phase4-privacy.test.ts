// Phase 4.6 — droits des personnes : chacun télécharge ses données ; un
// administrateur anonymise un ancien compte (identité effacée, montants
// conservés), sous conditions, avec mot de passe et confirmation écrite.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { hashPassword } from '../src/lib/password'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `prv-${Date.now()}`
const PASSWORD = 'Admin-Test-Privacy-2026'
const OLD = new Date(Date.now() - 4 * 365 * 24 * 60 * 60 * 1000)
type Person = { id: string; email: string; role: string }
let admin: Person, membre: Person, ancien: Person, collecteur: Person
let rubriqueId = ''
let ancienMembreId = ''

async function person(tag: string, role: string, extra: Record<string, unknown> = {}): Promise<Person> {
  const u = await prisma.user.create({
    data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'T', fullName: `${tag} T`, email: `${RUN}-${tag}@test.local`, phone: `+2376${String(Date.now()).slice(-7)}${tag.length}`, passwordHash: 'disabled', role: role as never, mustChangePassword: false, ...extra },
  })
  return { id: u.id, email: u.email, role }
}

async function call(p: Person, method: 'get' | 'post', path: string, body?: Record<string, unknown>) {
  const cookie = await testCookie({ userId: p.id, role: p.role, email: p.email })
  const res = await request(app).get('/api/csrf-token').set('Cookie', cookie)
  const csrf = (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]
  const r = request(app)[method](path).set('Cookie', `${cookie}; ${csrf}`).set('x-csrf-token', res.body.token as string)
  return body ? r.send(body) : r
}

const anonymize = (target: string, body: Record<string, unknown> = { password: PASSWORD, confirmation: 'ANONYMISER' }) =>
  call(admin, 'post', `/api/privacy/users/${target}/anonymize`, body)

beforeAll(async () => {
  admin = await person('adm', 'ADMIN', { passwordHash: await hashPassword(PASSWORD) })
  collecteur = await person('col', 'COLLECTEUR')
  membre = await person('mem', 'MEMBRE')
  ancien = await person('anc', 'MEMBRE')
  rubriqueId = (await prisma.rubrique.create({
    data: { code: `${RUN}-R`, title: 'Rubrique vie privée', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), status: 'OUVERTE', createdById: admin.id, createdByName: 'A' },
  })).id
  const m = await prisma.membre.create({ data: { userId: membre.id, memberId: `${RUN}-m1`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE', adresse: 'Melen', notes: 'Note du bureau' } })
  await prisma.contribution.create({ data: { membreId: m.id, rubriqueId, montant: 5000, modePaiement: 'ESPECES', statut: 'CONFIRME', collecteurId: collecteur.id } })
  ancienMembreId = (await prisma.membre.create({ data: { userId: ancien.id, memberId: `${RUN}-m2`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE', adresse: 'Biyem-Assi', profession: 'Enseignant', phone: '690123456' } })).id
  await prisma.contribution.create({ data: { membreId: ancienMembreId, rubriqueId, montant: 7000, modePaiement: 'MTN_MOMO', statut: 'CONFIRME', mobileMoneyPhone: '690123456', localisationFonds: 'PORTEFEUILLE_ELECTRONIQUE', createdAt: OLD } })
  await prisma.notification.create({ data: { userId: ancien.id, title: 'Bienvenue', body: 'Message personnel', type: 'INFO' } })
})

describe('Mes données (accès et portabilité)', () => {
  it('le membre télécharge ses données : profil, fiche, contributions ; jamais le mot de passe', async () => {
    const res = await call(membre, 'get', '/api/privacy/my-data')
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/mes-donnees-sgm-cem-\d{4}-\d{2}-\d{2}\.json/)
    const data = JSON.parse(res.text)
    expect(data.compte.email).toBe(membre.email)
    expect(data.ficheMembre.adresse).toBe('Melen')
    expect(data.contributions).toHaveLength(1)
    expect(data.contributions[0]).toMatchObject({ montant: 5000, rubrique: `${RUN}-R — Rubrique vie privée` })
    expect(res.text).not.toContain('passwordHash')
    expect(await prisma.auditLog.count({ where: { userId: membre.id, action: 'EXPORT', entityType: 'DonneesPersonnelles' } })).toBe(1)
  })

  it('le collecteur voit ses encaissements sans l\'identité des payeurs', async () => {
    const data = JSON.parse((await call(collecteur, 'get', '/api/privacy/my-data')).text)
    expect(data.encaissementsCommeCollecteur).toHaveLength(1)
    expect(JSON.stringify(data.encaissementsCommeCollecteur)).not.toContain('mem T')
  })
})

describe('Anonymisation', () => {
  it('compte actif : refusée, avec la raison', async () => {
    const check = await call(admin, 'get', `/api/privacy/users/${ancien.id}/anonymization`)
    expect(check.body.data.possible).toBe(false)
    expect(check.body.data.blockers.join(' ')).toContain('Désactivez')
    expect((await anonymize(ancien.id)).status).toBe(400)
  })

  it('délai de conservation non écoulé : refusée', async () => {
    await prisma.user.update({ where: { id: membre.id }, data: { isActive: false } })
    const check = await call(admin, 'get', `/api/privacy/users/${membre.id}/anonymization`)
    expect(check.body.data.blockers.join(' ')).toContain('Délai de conservation non écoulé')
  })

  it('mot de passe, confirmation écrite et rôle exigés', async () => {
    await prisma.user.update({ where: { id: ancien.id }, data: { isActive: false } })
    await prisma.$executeRaw`UPDATE "users" SET "updatedAt" = ${OLD}, "lastLoginAt" = NULL WHERE "id" = ${ancien.id}`
    expect((await anonymize(ancien.id, { password: PASSWORD, confirmation: 'oui' })).status).toBe(400)
    expect((await anonymize(ancien.id, { password: 'faux', confirmation: 'ANONYMISER' })).status).toBe(403)
    expect((await call(collecteur, 'post', `/api/privacy/users/${ancien.id}/anonymize`, { password: PASSWORD, confirmation: 'ANONYMISER' })).status).toBe(403)
    expect((await anonymize(admin.id)).status).toBe(400)
  })

  it('identité effacée, montants conservés, traces personnelles supprimées', async () => {
    const check = await call(admin, 'get', `/api/privacy/users/${ancien.id}/anonymization`)
    expect(check.body.data).toMatchObject({ possible: true, blockers: [] })
    const res = await anonymize(ancien.id)
    expect(res.status).toBe(200)

    const u = await prisma.user.findUniqueOrThrow({ where: { id: ancien.id } })
    expect(u.fullName).toBe(`Personne anonymisée (${RUN}-anc)`)
    expect(u.email).toMatch(/@anonymise\.invalid$/)
    expect(u.phone).toBeNull()
    expect(u.isActive).toBe(false)
    const m = await prisma.membre.findUniqueOrThrow({ where: { id: ancienMembreId } })
    expect(m).toMatchObject({ phone: null, adresse: null, profession: null })
    const c = await prisma.contribution.findFirstOrThrow({ where: { membreId: ancienMembreId } })
    expect(c).toMatchObject({ montant: 7000, statut: 'CONFIRME', mobileMoneyPhone: null })
    expect(await prisma.notification.count({ where: { userId: ancien.id } })).toBe(0)
    const log = await prisma.auditLog.findFirst({ where: { action: 'ANONYMIZE', entityId: ancien.id, userId: admin.id }, orderBy: { createdAt: 'desc' } })
    expect(log?.details).toMatchObject({ matricule: `${RUN}-anc` })
    // Plus aucune donnée identifiante dans le journal de l'opération
    expect(JSON.stringify(log?.details)).not.toContain('Biyem-Assi')
    // Une seconde fois : déjà fait
    expect((await anonymize(ancien.id)).status).toBe(400)
  })
})
