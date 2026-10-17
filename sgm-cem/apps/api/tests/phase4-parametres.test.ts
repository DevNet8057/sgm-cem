// Phase 4.5 — paramètres utiles : mode maintenance, ratios lisibles par les
// responsables, reconduction annuelle des rubriques, membres inactifs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { getConfig, updateConfig } from '../src/services/config.service'
import { SCHEDULED_JOBS } from '../src/jobs/scheduler'
import { findInactiveMembers, runInactiveMembersReport } from '../src/services/inactive-members.service'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `prm-${Date.now()}`
type Person = { id: string; email: string; role: string }
let developer: Person, tresorier: Person, responsable: Person, collecteur: Person
let rubriqueId = ''
let inactifId = ''
let actifId = ''
let savedMaintenance = 'false'
let savedRate = 5

async function person(tag: string, role: string): Promise<Person> {
  const u = await prisma.user.create({
    data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'T', fullName: `${tag} T`, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: role as never, mustChangePassword: false },
  })
  return { id: u.id, email: u.email, role }
}

async function call(p: Person, method: 'get' | 'post' | 'patch', path: string, body?: Record<string, unknown>) {
  const cookie = await testCookie({ userId: p.id, role: p.role, email: p.email })
  const res = await request(app).get('/api/csrf-token').set('Cookie', cookie)
  const csrf = (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]
  const r = request(app)[method](path).set('Cookie', `${cookie}; ${csrf}`).set('x-csrf-token', res.body.token as string)
  return body ? r.send(body) : r
}

const setMaintenance = (value: string) => updateConfig('MAINTENANCE_MODE', value, { id: developer.id, fullName: 'dev T' }, 'test', { category: 'INFRASTRUCTURE', label: 'Mode maintenance' })

beforeAll(async () => {
  developer = await person('dev', 'DEVELOPER')
  tresorier = await person('tres', 'TRESORIER')
  responsable = await person('resp', 'RESPONSABLE')
  collecteur = await person('col', 'COLLECTEUR')
  savedMaintenance = getConfig('MAINTENANCE_MODE') ?? 'false'
  const s = await prisma.systemSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } })
  savedRate = s.defaultIncreaseRate
  await prisma.systemSettings.update({ where: { id: 'singleton' }, data: { defaultIncreaseRate: 5, inactivityMonthsThreshold: 6 } })
  rubriqueId = (await prisma.rubrique.create({
    data: {
      code: `${RUN}-CD-2026`, title: 'Contribution District 2026', type: 'REGULIERE_MENSUELLE', fiscalYear: 2026,
      openDate: new Date('2026-01-01T00:00:00Z'), closeDate: new Date('2026-12-31T00:00:00Z'), status: 'OUVERTE',
      amountTravailleur: 12000, amountEtudiant: 6000, amountCouple: 18000, createdById: tresorier.id, createdByName: 'T',
    },
  })).id
  const old = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
  const mk = async (tag: string) => {
    const u = await person(tag, 'MEMBRE')
    return (await prisma.membre.create({ data: { userId: u.id, memberId: `${RUN}-${tag}m`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE', dateAdhesion: old } })).id
  }
  inactifId = await mk('inactif')
  actifId = await mk('actif')
  await prisma.contribution.create({ data: { membreId: inactifId, rubriqueId, montant: 1000, modePaiement: 'ESPECES', statut: 'CONFIRME', createdAt: new Date(Date.now() - 300 * 24 * 60 * 60 * 1000) } })
  await prisma.contribution.create({ data: { membreId: actifId, rubriqueId, montant: 1000, modePaiement: 'ESPECES', statut: 'CONFIRME' } })
})

afterAll(async () => {
  await setMaintenance(savedMaintenance)
  await prisma.systemSettings.update({ where: { id: 'singleton' }, data: { defaultIncreaseRate: savedRate } })
})

describe('Mode maintenance', () => {
  it('écritures refusées (503) sauf pour le développeur ; lecture et connexion possibles ; état public', async () => {
    await setMaintenance('true')
    try {
      const status = await request(app).get('/api/status')
      expect(status.body.data.maintenance).toBe(true)
      const blocked = await call(tresorier, 'patch', '/api/settings', { reminderDelayDays: 7 })
      expect(blocked.status).toBe(503)
      expect(blocked.body.error.code).toBe('MAINTENANCE')
      expect((await call(tresorier, 'get', '/api/settings')).status).toBe(200)
      expect((await call(developer, 'patch', '/api/settings', { reminderDelayDays: 7 })).status).toBe(200)
      // Connexion : jamais bloquée par la maintenance (401/400 attendus, pas 503)
      expect((await call(collecteur, 'post', '/api/auth/login', { email: 'x@y.z', password: 'faux' })).status).not.toBe(503)
    } finally {
      await setMaintenance('false')
    }
    expect((await call(tresorier, 'patch', '/api/settings', { reminderDelayDays: 7 })).status).toBe(200)
  })
})

describe('Ratios et reconduction', () => {
  it('ratios lisibles par un responsable, pas par un collecteur', async () => {
    const res = await call(responsable, 'get', '/api/settings/ratios')
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ defaultIncreaseRate: 5 })
    expect(res.body.data).not.toHaveProperty('communityName')
    expect((await call(collecteur, 'get', '/api/settings/ratios')).status).toBe(403)
  })

  it('reconduction N+1 : code et titre de l\'année suivante, montants revalorisés, dates décalées', async () => {
    const res = await call(responsable, 'post', `/api/rubriques/${rubriqueId}/reconduire`, {})
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      code: `${RUN}-CD-2027`, title: 'Contribution District 2027', fiscalYear: 2027, status: 'OUVERTE',
      amountTravailleur: 12600, amountEtudiant: 6300, amountCouple: 18900,
    })
    expect(res.body.data.openDate).toMatch(/^2027-01-01/)
    expect((await prisma.rubrique.findUniqueOrThrow({ where: { id: rubriqueId } })).amountTravailleur).toBe(12000)
    expect((await call(responsable, 'post', `/api/rubriques/${rubriqueId}/reconduire`, {})).status).toBe(409)
  })

  it('taux choisi et refus pour un collecteur', async () => {
    const res = await call(tresorier, 'post', `/api/rubriques/${rubriqueId}/reconduire`, { fiscalYear: 2028, increaseRate: 10 })
    expect(res.body.data).toMatchObject({ code: `${RUN}-CD-2028`, amountTravailleur: 13200 })
    expect((await call(collecteur, 'post', `/api/rubriques/${rubriqueId}/reconduire`, { fiscalYear: 2029 })).status).toBe(403)
  })
})

describe('Membres inactifs', () => {
  it('liste : sans contribution confirmée depuis le seuil', async () => {
    const { members, thresholdMonths } = await findInactiveMembers()
    expect(thresholdMonths).toBe(6)
    const ids = members.map(m => m.id)
    expect(ids).toContain(inactifId)
    expect(ids).not.toContain(actifId)
    const res = await call(responsable, 'get', '/api/membres/inactifs')
    expect(res.status).toBe(200)
    expect((await call(collecteur, 'get', '/api/membres/inactifs')).status).toBe(403)
  })

  it('signalement mensuel planifié, notifié aux responsables', async () => {
    expect(SCHEDULED_JOBS.map(j => j.name)).toContain('membres-inactifs')
    expect(await runInactiveMembersReport()).toBeGreaterThan(0)
    expect(await prisma.notification.count({ where: { userId: responsable.id, title: 'Membres inactifs' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: collecteur.id, title: 'Membres inactifs' } })).toBe(0)
  })
})
