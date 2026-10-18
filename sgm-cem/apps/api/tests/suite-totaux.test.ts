// Reste à faire n° 8 (EF-M04-06) : sur la liste des rubriques, le total global est
// réservé au niveau 3 et plus ; un collecteur voit ses encaissements, un membre les siens.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `tot-${Date.now()}`
type Person = { id: string; email: string; role: string }
let colA: Person, colB: Person, resp: Person, memX: Person
let rubriqueId = ''

async function person(tag: string, role: string): Promise<Person> {
  const u = await prisma.user.create({
    data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'T', fullName: `${tag} T`, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: role as never, mustChangePassword: false },
  })
  return { id: u.id, email: u.email, role }
}

async function rubriqueFor(p: Person) {
  const res = await request(app).get('/api/rubriques').set('Cookie', await testCookie({ userId: p.id, role: p.role, email: p.email }))
  expect(res.status).toBe(200)
  return res.body.data.find((r: { id: string }) => r.id === rubriqueId)
}

beforeAll(async () => {
  colA = await person('colA', 'COLLECTEUR')
  colB = await person('colB', 'COLLECTEUR')
  resp = await person('resp', 'RESPONSABLE')
  memX = await person('memX', 'MEMBRE')
  const memY = await person('memY', 'MEMBRE')
  const mX = await prisma.membre.create({ data: { userId: memX.id, memberId: `${RUN}-mx`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })
  const mY = await prisma.membre.create({ data: { userId: memY.id, memberId: `${RUN}-my`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })
  rubriqueId = (await prisma.rubrique.create({
    data: { code: `${RUN}-R`, title: 'Rubrique totaux', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), status: 'OUVERTE', createdById: resp.id, createdByName: 'R' },
  })).id
  await prisma.contribution.createMany({
    data: [
      { membreId: mX.id, rubriqueId, montant: 2000, modePaiement: 'ESPECES', statut: 'CONFIRME', collecteurId: colA.id },
      { membreId: mY.id, rubriqueId, montant: 3000, modePaiement: 'ESPECES', statut: 'CONFIRME', collecteurId: colB.id },
    ],
  })
})

describe('Totaux des rubriques selon le rôle', () => {
  it('niveau 3 : total global', async () => {
    expect(await rubriqueFor(resp)).toMatchObject({ totalScope: 'GLOBAL', totalCollecte: 5000, nbContributions: 2 })
  })

  it('collecteur : ses seuls encaissements, sans compteur global', async () => {
    const r = await rubriqueFor(colA)
    expect(r).toMatchObject({ totalScope: 'COLLECTEUR', totalCollecte: 2000, nbContributions: 1 })
    expect(r._count).toBeUndefined()
  })

  it('membre : ses seules contributions', async () => {
    expect(await rubriqueFor(memX)).toMatchObject({ totalScope: 'MEMBRE', totalCollecte: 2000, nbContributions: 1 })
  })
})
