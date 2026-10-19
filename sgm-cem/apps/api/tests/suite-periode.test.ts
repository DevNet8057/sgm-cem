// Consultation de l'historique : filtre ?year=&month= des listes de contributions
// et bornes de mois à l'heure de Yaoundé (UTC+1).
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { periodBounds } from '../src/services/closure.service'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `per-${Date.now()}`
let tresorier = { id: '', email: '', role: 'TRESORIER' }
let membre = { id: '', email: '', role: 'MEMBRE' }
let rubriqueId = ''

beforeAll(async () => {
  const mk = async (tag: string, role: string) => {
    const u = await prisma.user.create({ data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'P', fullName: `${tag} P`, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: role as never, mustChangePassword: false } })
    return { id: u.id, email: u.email, role }
  }
  tresorier = await mk('tre', 'TRESORIER')
  membre = await mk('mem', 'MEMBRE')
  const membreId = (await prisma.membre.create({ data: { userId: membre.id, memberId: `CEM-2019-9${String(Date.now()).slice(-5)}`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })).id
  rubriqueId = (await prisma.rubrique.create({ data: { code: `${RUN}-R`, title: 'Rubrique période', type: 'PONCTUELLE', fiscalYear: 2019, openDate: new Date('2019-01-01'), status: 'OUVERTE', createdById: tresorier.id, createdByName: 'T' } })).id
  // 31 mars 2019 à 23h30 heure de Yaoundé = 22h30 UTC : appartient à mars
  for (const createdAt of ['2019-03-31T22:30:00Z', '2019-04-01T10:00:00Z', '2019-07-15T10:00:00Z']) {
    await prisma.contribution.create({ data: { membreId, rubriqueId, montant: 1000, modePaiement: 'ESPECES', statut: 'CONFIRME', createdAt: new Date(createdAt) } })
  }
})

const list = async (who: { id: string; email: string; role: string }, path: string) =>
  request(app).get(path).set('Cookie', await testCookie({ userId: who.id, role: who.role, email: who.email }))

describe('Historique par période', () => {
  it('bornes de mois à l\'heure de Yaoundé', () => {
    const { start, end } = periodBounds(2019, 3)
    expect(start.toISOString()).toBe('2019-02-28T23:00:00.000Z')
    expect(end.toISOString()).toBe('2019-03-31T22:59:59.999Z')
  })

  it('liste des contributions : année, mois, ou toutes les périodes', async () => {
    const base = `/api/contributions?rubriqueId=${rubriqueId}&limit=50`
    expect((await list(tresorier, base)).body.data).toHaveLength(3)
    expect((await list(tresorier, `${base}&year=2019`)).body.data).toHaveLength(3)
    expect((await list(tresorier, `${base}&year=2019&month=3`)).body.data).toHaveLength(1)
    expect((await list(tresorier, `${base}&year=2019&month=4`)).body.data).toHaveLength(1)
    expect((await list(tresorier, `${base}&year=2018`)).body.data).toHaveLength(0)
  })

  it('mes contributions : même filtre pour le membre', async () => {
    expect((await list(membre, '/api/contributions/me?year=2019&month=7')).body.data).toHaveLength(1)
    expect((await list(membre, '/api/contributions/me?year=2020')).body.data).toHaveLength(0)
  })

  it('tableau de bord : totaux de la période demandée', async () => {
    const res = await list(tresorier, '/api/stats/dashboard?year=2019&month=3')
    expect(res.body.data).toMatchObject({ year: 2019, month: 3 })
    expect(res.body.data.totalCollectedPeriod).toBeGreaterThanOrEqual(1000)
  })
})
