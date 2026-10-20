// Point 15 : accueils par rôle et indicateurs calculés côté serveur (EF-M10-01, EF-M10-05).
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `acc-${Date.now()}`
type Who = { id: string; email: string; role: string }
let col: Who, tre: Who
let membreId = ''
let rubriqueId = ''

beforeAll(async () => {
  const mk = async (tag: string, role: string): Promise<Who> => {
    const u = await prisma.user.create({ data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'A', fullName: `${tag} A`, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: role as never, mustChangePassword: false } })
    return { id: u.id, email: u.email, role }
  }
  col = await mk('col', 'COLLECTEUR')
  tre = await mk('tre', 'TRESORIER')
  const m = await mk('mem', 'MEMBRE')
  membreId = (await prisma.membre.create({ data: { userId: m.id, memberId: `CEM-2017-9${String(Date.now()).slice(-5)}`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })).id
  rubriqueId = (await prisma.rubrique.create({ data: { code: `${RUN}-R`, title: 'Accueil', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), status: 'OUVERTE', createdById: tre.id, createdByName: 'T' } })).id
  const base = { membreId, rubriqueId, collecteurId: col.id }
  const now = new Date()
  // 30 encaissements confirmés détenus par le collecteur (plus que la page de 20 de l'ancien calcul)
  for (let i = 0; i < 30; i++) {
    await prisma.contribution.create({ data: { ...base, montant: 1000, modePaiement: 'ESPECES', statut: 'CONFIRME', confirmedAt: now, detenteurId: col.id, localisationFonds: 'CHEZ_COLLECTEUR' } })
  }
  // 2 détenus depuis 30 jours : à remettre
  for (let i = 0; i < 2; i++) {
    await prisma.contribution.create({ data: { ...base, montant: 500, modePaiement: 'ESPECES', statut: 'CONFIRME', confirmedAt: new Date(now.getTime() - 30 * 86400_000), detenteurId: col.id, localisationFonds: 'CHEZ_COLLECTEUR' } })
  }
  // 3 déclarations à valider, 1 litige
  for (let i = 0; i < 3; i++) await prisma.contribution.create({ data: { ...base, montant: 200, modePaiement: 'ESPECES', statut: 'EN_ATTENTE_CONFIRMATION' } })
  await prisma.contribution.create({ data: { ...base, montant: 700, modePaiement: 'ESPECES', statut: 'LITIGE' } })
  // Paiement Mobile Money sans réponse depuis 2 heures : bloqué
  await prisma.contribution.create({ data: { membreId, rubriqueId, montant: 1500, modePaiement: 'MTN_MOMO', statut: 'EN_ATTENTE_CONFIRMATION', paymentStatus: 'PROCESSING', externalTransactionId: `${RUN}-tx`, createdAt: new Date(now.getTime() - 2 * 3600_000) } })
})

const get = async (who: Who, path: string) => request(app).get(path).set('Cookie', await testCookie({ userId: who.id, role: who.role, email: who.email }))

describe('Accueil du collecteur', () => {
  it('fonds détenus, à valider, encaissé ce mois et litiges calculés sur tout son périmètre', async () => {
    const res = await get(col, '/api/stats/collecteur')
    expect(res.status).toBe(200)
    expect(res.body.data.fondsDetenus).toMatchObject({ montant: 31000, nombre: 32, aRemettre: 2 })
    expect(res.body.data.aValider).toMatchObject({ nombre: 3, montant: 600 })
    expect(res.body.data.encaisseMois.montant).toBeGreaterThanOrEqual(30000)
    expect(res.body.data.litiges).toBe(1)
  })
})

describe('Accueil du trésorier', () => {
  it('« À traiter » : paiements électroniques bloqués comptés', async () => {
    const res = await get(tre, '/api/contributions/todo')
    expect(res.body.data.blockedPayments).toBeGreaterThanOrEqual(1)
    expect(res.body.data.openDisputes).toBeGreaterThanOrEqual(1)
    // Un collecteur ne voit pas les paiements bloqués de toute la communauté
    expect((await get(col, '/api/contributions/todo')).body.data.blockedPayments).toBe(0)
  })

  it('tendance : indicateurs de la période précédente renvoyés', async () => {
    const res = await get(tre, '/api/stats/dashboard?year=2026&month=3')
    expect(res.body.data.previous).toEqual(expect.objectContaining({ totalCollectedPeriod: expect.any(Number), totalConfirmedContributions: expect.any(Number), globalConfirmationRate: expect.any(Number), litiges: expect.any(Number) }))
  })

  it('litiges : nombre et montant sur tous les litiges, liste paginée', async () => {
    const res = await get(tre, '/api/contributions/litiges?limit=1')
    expect(res.body.data).toHaveLength(1)
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(1)
    expect(res.body.pagination.totalAmount).toBeGreaterThanOrEqual(700)
  })

  it('GED : compteurs calculés par le serveur', async () => {
    const res = await get(tre, '/api/commissions/documents')
    expect(res.status).toBe(200)
    expect(res.body.meta).toEqual(expect.objectContaining({ total: expect.any(Number), parStatut: expect.any(Object) }))
  })
})
