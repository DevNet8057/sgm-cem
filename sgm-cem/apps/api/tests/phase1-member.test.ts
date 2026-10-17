// Phase 1.8 (UX-03) — espace membre : totaux calculés par l'API sur tout
// l'historique, recherche serveur, reçu téléchargeable par son seul propriétaire.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `mb-${Date.now()}`
let owner = { id: '', email: '' }
let other = { id: '', email: '' }
let confirmedId = ''

async function member(tag: string) {
  const user = await prisma.user.create({
    data: { memberId: `${RUN}-${tag}`, firstName: 'M', lastName: tag, fullName: `M ${tag}`, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: 'MEMBRE', mustChangePassword: false },
  })
  const membre = await prisma.membre.create({ data: { userId: user.id, memberId: `${RUN}-${tag}-m`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })
  return { user, membre }
}

beforeAll(async () => {
  const a = await member('a')
  const b = await member('b')
  owner = { id: a.user.id, email: a.user.email }
  other = { id: b.user.id, email: b.user.email }
  const rubrique = await prisma.rubrique.create({
    data: { code: `${RUN}-RECH`, title: 'Rubrique recherchée', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), createdById: a.user.id, createdByName: 'T' },
  })
  // 25 contributions : plus qu'une page de 20
  for (let i = 0; i < 25; i++) {
    const c = await prisma.contribution.create({
      data: { membreId: a.membre.id, rubriqueId: rubrique.id, montant: 100, modePaiement: 'ESPECES', statut: i < 22 ? 'CONFIRME' : 'EN_ATTENTE_CONFIRMATION' },
    })
    if (i === 0) confirmedId = c.id
  }
})

describe('Espace membre', () => {
  it('les totaux portent sur tout l\'historique, pas sur la page affichée', async () => {
    const cookie = await testCookie({ userId: owner.id, role: 'MEMBRE', email: owner.email })
    const res = await request(app).get('/api/contributions/me/summary').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.data.totalCount).toBe(25)
    expect(res.body.data.confirmedAmount).toBe(2200)
    expect(res.body.data.pendingCount).toBe(3)
  })

  it('la recherche par rubrique couvre tout l\'historique', async () => {
    const cookie = await testCookie({ userId: owner.id, role: 'MEMBRE', email: owner.email })
    const res = await request(app).get('/api/contributions/me').query({ search: 'recherchée', limit: 20 }).set('Cookie', cookie)
    expect(res.body.pagination.total).toBe(25)
  })

  it('un autre membre ne peut pas télécharger ce reçu', async () => {
    const cookie = await testCookie({ userId: other.id, role: 'MEMBRE', email: other.email })
    const res = await request(app).get(`/api/contributions/${confirmedId}/receipt`).set('Cookie', cookie)
    expect(res.status).toBe(404)
  })
})
