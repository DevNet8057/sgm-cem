// Phase 2.5 — listes : filtres côté serveur (le dépôt bancaire voyait au plus
// 100 contributions), recherche réelle, nom du donateur public renvoyé (UX-10).
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `lst-${Date.now()}`
let tresorier = { id: '', email: '' }
let rubriqueId = ''

beforeAll(async () => {
  const t = await prisma.user.create({
    data: { memberId: `${RUN}-t`, firstName: 'T', lastName: 't', fullName: 'T t', email: `${RUN}-t@test.local`, passwordHash: 'disabled', role: 'TRESORIER', mustChangePassword: false },
  })
  tresorier = { id: t.id, email: t.email }
  rubriqueId = (await prisma.rubrique.create({
    data: { code: `${RUN}-R`, title: `Rubrique ${RUN}`, type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), createdById: t.id, createdByName: 'T' },
  })).id
  await prisma.contribution.createMany({
    data: Array.from({ length: 120 }, () => ({ rubriqueId, montant: 100, modePaiement: 'ESPECES' as const, statut: 'CONFIRME' as const, localisationFonds: 'EN_CAISSE' as const })),
  })
  const donateur = await prisma.contributeurExterne.create({ data: { nom: `Donatrice ${RUN}`, phone: '+237690000000' } })
  await prisma.contribution.create({
    data: { rubriqueId, montant: 5000, modePaiement: 'MTN_MOMO', statut: 'CONFIRME', localisationFonds: 'PORTEFEUILLE_ELECTRONIQUE', contributeurExterneId: donateur.id },
  })
})

async function list(params: Record<string, string | number>) {
  const cookie = await testCookie({ userId: tresorier.id, role: 'TRESORIER', email: tresorier.email })
  return request(app).get('/api/contributions').query(params).set('Cookie', cookie)
}

describe('Listes paginées côté serveur', () => {
  it('le filtre d\'emplacement couvre tout, au-delà d\'une page de 100', async () => {
    const page1 = await list({ rubriqueId, statut: 'CONFIRME', localisation: 'EN_CAISSE,PORTEFEUILLE_ELECTRONIQUE', limit: 100, page: 1 })
    expect(page1.status).toBe(200)
    expect(page1.body.pagination.total).toBe(121)
    expect(page1.body.pagination.totalAmount).toBe(120 * 100 + 5000)
    expect(page1.body.data).toHaveLength(100)
    const page2 = await list({ rubriqueId, statut: 'CONFIRME', localisation: 'EN_CAISSE,PORTEFEUILLE_ELECTRONIQUE', limit: 100, page: 2 })
    expect(page2.body.data).toHaveLength(21)
  })

  it('un emplacement inconnu est refusé', async () => {
    const res = await list({ localisation: 'SOUS_LE_MATELAS' })
    expect(res.status).toBe(400)
  })

  it('la recherche trouve un don public par le nom du donateur, nom renvoyé', async () => {
    const res = await list({ search: `Donatrice ${RUN}` })
    expect(res.body.pagination.total).toBe(1)
    expect(res.body.data[0].contributeurExterne.nom).toBe(`Donatrice ${RUN}`)
  })

  it('le filtre de mode de paiement est appliqué', async () => {
    const res = await list({ rubriqueId, modePaiement: 'MTN_MOMO' })
    expect(res.body.pagination.total).toBe(1)
  })

  it('la liste des membres est bornée (valeur invalide ou démesurée)', async () => {
    const cookie = await testCookie({ userId: tresorier.id, role: 'TRESORIER', email: tresorier.email })
    const invalid = await request(app).get('/api/membres').query({ limit: 'abc', page: 'x' }).set('Cookie', cookie)
    expect(invalid.status).toBe(200)
    expect(invalid.body.pagination).toMatchObject({ page: 1, limit: 20 })
    const huge = await request(app).get('/api/membres').query({ limit: 1_000_000 }).set('Cookie', cookie)
    expect(huge.body.pagination.limit).toBe(100)
  })
})
