// EF-M06-01 : file « À valider » — espèces et virements seulement, du plus ancien
// au plus récent, paginée, totaux calculés par le serveur.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `fv-${Date.now()}`
let col = { id: '', email: '', role: 'COLLECTEUR' }

beforeAll(async () => {
  const u = await prisma.user.create({ data: { memberId: `${RUN}-c`, firstName: 'Col', lastName: 'F', fullName: 'Col F', email: `${RUN}-c@test.local`, passwordHash: 'disabled', role: 'COLLECTEUR', mustChangePassword: false } })
  col = { id: u.id, email: u.email, role: 'COLLECTEUR' }
  const m = await prisma.user.create({ data: { memberId: `${RUN}-m`, firstName: 'Mem', lastName: 'F', fullName: 'Mem F', email: `${RUN}-m@test.local`, passwordHash: 'disabled', role: 'MEMBRE', mustChangePassword: false } })
  const membreId = (await prisma.membre.create({ data: { userId: m.id, memberId: `CEM-2018-9${String(Date.now()).slice(-5)}`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })).id
  const rubriqueId = (await prisma.rubrique.create({ data: { code: `${RUN}-R`, title: 'File', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), status: 'OUVERTE', createdById: u.id, createdByName: 'C' } })).id
  const base = { membreId, rubriqueId, collecteurId: u.id, statut: 'EN_ATTENTE_CONFIRMATION' as const }
  // 25 déclarations manuelles (la plus ancienne vaut 1 FCFA) et 2 paiements électroniques
  for (let i = 0; i < 25; i++) {
    await prisma.contribution.create({ data: { ...base, montant: i + 1, modePaiement: i % 2 ? 'VIREMENT' : 'ESPECES', createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)) } })
  }
  await prisma.contribution.create({ data: { ...base, montant: 9999, modePaiement: 'MTN_MOMO', externalTransactionId: `${RUN}-x1` } })
  await prisma.contribution.create({ data: { ...base, montant: 9999, modePaiement: 'CARTE_VISA', externalTransactionId: `${RUN}-x2` } })
})

const get = async (path: string) => request(app).get(path).set('Cookie', await testCookie({ userId: col.id, role: col.role, email: col.email }))

describe('File « À valider »', () => {
  it('paiements électroniques exclus, comptés à part ; tri du plus ancien', async () => {
    const res = await get('/api/contributions/validations?limit=20')
    expect(res.status).toBe(200)
    expect(res.body.pagination).toMatchObject({ page: 1, total: 25, totalPages: 2, totalAmount: (25 * 26) / 2 })
    expect(res.body.meta.electronicPending).toBe(2)
    const montants = (res.body.data as Array<{ montant: number; modePaiement: string }>).map(c => c.montant)
    expect(montants).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect((res.body.data as Array<{ modePaiement: string }>).every(c => ['ESPECES', 'VIREMENT'].includes(c.modePaiement))).toBe(true)
  })

  it('page suivante : les plus récentes', async () => {
    const res = await get('/api/contributions/validations?limit=20&page=2')
    expect((res.body.data as Array<{ montant: number }>).map(c => c.montant)).toEqual([21, 22, 23, 24, 25])
  })

  it('limite bornée à 100', async () => {
    expect((await get('/api/contributions/validations?limit=500')).status).toBe(400)
  })
})
