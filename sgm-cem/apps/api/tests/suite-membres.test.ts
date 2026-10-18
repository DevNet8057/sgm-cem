// Reste à faire n° 6 : création d'un membre sans perte (adresse, dates, notes —
// EF-M03-01) et matricules uniques même en parallèle (EF-M02-06).
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { nextMatricules } from '../src/services/matricule.service'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `mbr-${Date.now()}`
let cookie = ''
let token = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { memberId: `${RUN}-resp`, firstName: 'R', lastName: 'T', fullName: 'R T', email: `${RUN}-resp@test.local`, passwordHash: 'disabled', role: 'RESPONSABLE', mustChangePassword: false },
  })
  const auth = await testCookie({ userId: u.id, role: 'RESPONSABLE', email: u.email })
  const res = await request(app).get('/api/csrf-token').set('Cookie', auth)
  cookie = `${auth}; ${(res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]}`
  token = res.body.token
})

// Numéros uniques par exécution (le téléphone d'un compte est unique)
let phoneSeq = 0
const nextPhone = () => `6${String(Date.now()).slice(-7)}${phoneSeq++}`

const create = (tag: string, extra: Record<string, unknown> = {}) =>
  request(app).post('/api/membres').set('Cookie', cookie).set('x-csrf-token', token).send({
    firstName: 'Awa', lastName: `Test ${tag}`, email: `${RUN}-${tag}@test.local`, phone: nextPhone(),
    categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE', ...extra,
  })

describe('Création d\'un membre', () => {
  it('adresse, dates et notes sont enregistrées', async () => {
    const res = await create('champs', {
      adresse: 'Melen, Yaoundé', notes: 'Chef de chorale',
      dateAdhesion: '2019-09-01T00:00:00.000Z', dateNaissance: '1990-04-12T00:00:00.000Z',
    })
    expect(res.status).toBe(201)
    const m = await prisma.membre.findUniqueOrThrow({ where: { id: res.body.data.id } })
    expect(m).toMatchObject({ adresse: 'Melen, Yaoundé', notes: 'Chef de chorale' })
    expect(m.dateAdhesion.toISOString()).toBe('2019-09-01T00:00:00.000Z')
    expect(m.dateNaissance?.toISOString()).toBe('1990-04-12T00:00:00.000Z')
    expect(m.memberId).toMatch(/^CEM-\d{4}-\d{6}$/)
  })

  it('créations simultanées : matricules tous différents', async () => {
    const results = await Promise.all(['p1', 'p2', 'p3', 'p4'].map(t => create(t)))
    expect(results.map(r => r.status)).toEqual([201, 201, 201, 201])
    const ids = results.map(r => r.body.data.memberId)
    expect(new Set(ids).size).toBe(4)
  })

  it('téléphone déjà utilisé : conflit expliqué, pas une erreur serveur', async () => {
    const first = await create('dup')
    expect(first.status).toBe(201)
    const again = await request(app).post('/api/membres').set('Cookie', cookie).set('x-csrf-token', token).send({
      firstName: 'Awa', lastName: 'Bis', email: `${RUN}-dup2@test.local`, phone: first.body.data.phone, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE',
    })
    expect(again.status).toBe(409)
    expect(again.body.error.message).toMatch(/téléphone/)
  })

  it('un numéro déjà pris à la main est sauté', async () => {
    const [next] = await nextMatricules(1)
    const n = Number(next.slice(-6)) + 1
    const taken = `CEM-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`
    await prisma.user.create({ data: { memberId: taken, firstName: 'X', lastName: 'Y', fullName: 'X Y', email: `${RUN}-pris@test.local`, passwordHash: 'disabled', role: 'MEMBRE' } })
    const [after] = await nextMatricules(1)
    expect(after).not.toBe(taken)
  })
})
