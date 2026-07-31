import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { getJwtSecret } from '../src/lib/security'

const prisma = getPrisma()

function cookieFor(userId: string, role: string, email: string): string {
  return `access_token=${jwt.sign({ userId, role, email }, getJwtSecret(), { expiresIn: '15m' })}`
}

async function csrfFor(cookie: string) {
  const csrf = await request(app).get('/api/csrf-token').set('Cookie', cookie)
  const csrfCookie = (Array.isArray(csrf.headers['set-cookie']) ? csrf.headers['set-cookie'] : [])
    .find((c: string) => c.startsWith('csrf_token=')) ?? ''
  return { header: csrf.body.token as string, cookie: csrfCookie }
}

describe('Contribution Guidée — MEMBRE', () => {
  let membreCookie = ''
  let membreId = ''
  let userId = ''
  let collecteurId = ''
  let rubriqueId = ''
  let otherMembreId = ''

  beforeAll(async () => {
    const membre = await prisma.membre.findFirst({
      where: { isActive: true, user: { isActive: true } },
      include: { user: true },
    })
    if (!membre) throw new Error('Seed requis : membre actif')
    membreId = membre.id
    userId = membre.userId
    membreCookie = cookieFor(userId, 'MEMBRE', membre.user.email)

    const collecteur = await prisma.user.findFirst({ where: { role: 'COLLECTEUR', isActive: true } })
    if (!collecteur) throw new Error('Seed requis : collecteur')
    collecteurId = collecteur.id

    const rubrique = await prisma.rubrique.findFirst({ where: { status: 'OUVERTE' } })
    if (!rubrique) throw new Error('Seed requis : rubrique ouverte')
    rubriqueId = rubrique.id

    const otherMembre = await prisma.membre.findFirst({ where: { id: { not: membreId } } })
    if (otherMembre) otherMembreId = otherMembre.id
  })

  it('POST /api/contributions/declare — un MEMBRE peut désormais déclarer (plus de 403)', async () => {
    const { header, cookie } = await csrfFor(membreCookie)
    const res = await request(app)
      .post('/api/contributions/declare')
      .set('Cookie', `${membreCookie}; ${cookie}`)
      .set('x-csrf-token', header)
      .send({ collecteurId, rubriqueId, montant: 1000 })
    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    const created = await prisma.contribution.findUnique({ where: { id: res.body.data.id } })
    expect(created?.membreId).toBe(membreId)
  })

  it('la contribution déclarée apparaît dans GET /api/contributions/me du membre', async () => {
    const res = await request(app).get('/api/contributions/me').set('Cookie', membreCookie)
    expect(res.status).toBe(200)
    expect((res.body.data as Array<{ montant: number }>).some(c => c.montant === 1000)).toBe(true)
  })

  it('POST /api/payments/initiate — un MEMBRE ne peut pas payer en ESPECES via cette route', async () => {
    const { header, cookie } = await csrfFor(membreCookie)
    const res = await request(app)
      .post('/api/payments/initiate')
      .set('Cookie', `${membreCookie}; ${cookie}`)
      .set('x-csrf-token', header)
      .send({ membreId, rubriqueId, montant: 1000, modePaiement: 'ESPECES' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('BUSINESS_RULE')
  })

  it('POST /api/payments/initiate — un MEMBRE ne peut pas payer pour un autre membre', async () => {
    if (!otherMembreId) return
    const { header, cookie } = await csrfFor(membreCookie)
    const res = await request(app)
      .post('/api/payments/initiate')
      .set('Cookie', `${membreCookie}; ${cookie}`)
      .set('x-csrf-token', header)
      .send({ membreId: otherMembreId, rubriqueId, montant: 1000, modePaiement: 'CARTE_VISA' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ACCESS_DENIED')
  })
})

describe('Contribution Guidée — comportement STAFF inchangé (régression)', () => {
  it('POST /api/contributions/declare par un COLLECTEUR ne définit toujours pas membreId', async () => {
    const collecteur = await prisma.user.findFirst({ where: { role: 'COLLECTEUR', isActive: true } })
    const rubrique = await prisma.rubrique.findFirst({ where: { status: 'OUVERTE' } })
    if (!collecteur || !rubrique) return
    const cookie = cookieFor(collecteur.id, 'COLLECTEUR', collecteur.email)
    const { header, cookie: csrfCookie } = await csrfFor(cookie)
    const res = await request(app)
      .post('/api/contributions/declare')
      .set('Cookie', `${cookie}; ${csrfCookie}`)
      .set('x-csrf-token', header)
      .send({ collecteurId: collecteur.id, rubriqueId: rubrique.id, montant: 500, note: 'remise groupée test' })
    expect(res.status).toBe(201)
    const created = await prisma.contribution.findUnique({ where: { id: res.body.data.id } })
    expect(created?.membreId).toBeNull()
  })
})
