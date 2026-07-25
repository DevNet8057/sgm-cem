import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { getJwtSecret } from '../src/lib/security'

const prisma = getPrisma()

function cookieFor(userId: string, role: string, email: string): string {
  return `access_token=${jwt.sign({ userId, role, email }, getJwtSecret(), { expiresIn: '15m' })}`
}

// Integration tests for contribution endpoints.
// Unauthenticated calls should be rejected; we test surface-level guards here.
// For full flow tests, seed a test DB and authenticate first.

describe('Contributions API — unauthenticated guards', () => {
  it('GET /api/contributions rejects without auth cookie (401)', async () => {
    const res = await request(app).get('/api/contributions')
    expect([401, 403]).toContain(res.status)
  })

  it('GET /api/contributions/me rejects without auth cookie (401)', async () => {
    const res = await request(app).get('/api/contributions/me')
    expect([401, 403]).toContain(res.status)
  })

  it('GET /api/contributions/:id/timeline rejects without auth cookie (401)', async () => {
    const res = await request(app).get('/api/contributions/fake-id/timeline')
    expect([401, 403]).toContain(res.status)
  })

  it('POST /api/contributions rejects without auth cookie (401)', async () => {
    const res = await request(app)
      .post('/api/contributions')
      .send({ montant: 5000 })
    expect([401, 403]).toContain(res.status)
  })

  it('POST /api/contributions/declare rejects without auth (401)', async () => {
    const res = await request(app)
      .post('/api/contributions/declare')
      .send({ collecteurId: 'x', rubriqueId: 'y', montant: 1000 })
    expect([401, 403]).toContain(res.status)
  })

  it('POST /api/contributions/:id/proof rejects without auth cookie (401)', async () => {
    const res = await request(app).post('/api/contributions/fake-id/proof')
    expect([401, 403]).toContain(res.status)
  })

  it('PATCH /api/contributions/:id/confirm rejects without auth (401)', async () => {
    const res = await request(app).patch('/api/contributions/fake-id/confirm').send()
    expect([401, 403]).toContain(res.status)
  })
})

describe('Contributions API — authenticated read access', () => {
  it('GET /api/contributions/me returns only the authenticated member contributions with pagination', async () => {
    const membre = await prisma.membre.findFirst({
      where: { user: { isActive: true } },
      include: { user: true },
    })
    if (!membre) return

    const limit = 2
    const res = await request(app)
      .get(`/api/contributions/me?page=1&limit=${limit}`)
      .set('Cookie', cookieFor(membre.user.id, membre.user.role, membre.user.email))

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBeLessThanOrEqual(limit)

    const returnedIds = (res.body.data as Array<{ id: string }>).map(contribution => contribution.id)
    const contributions = await prisma.contribution.findMany({
      where: { id: { in: returnedIds } },
      select: { id: true, membreId: true },
    })
    expect(contributions).toHaveLength(returnedIds.length)
    for (const contribution of contributions) {
      expect(contribution.membreId).toBe(membre.id)
    }

    const total = await prisma.contribution.count({ where: { membreId: membre.id } })
    expect(res.body.pagination).toEqual({
      page: 1,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    })
  })

  it('GET /api/contributions limits a collector to their own contributions', async () => {
    const collecteur = await prisma.user.findFirst({
      where: { role: 'COLLECTEUR', isActive: true },
    })
    if (!collecteur) return

    const limit = 5
    const res = await request(app)
      .get(`/api/contributions?page=1&limit=${limit}`)
      .set('Cookie', cookieFor(collecteur.id, collecteur.role, collecteur.email))

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBeLessThanOrEqual(limit)
    for (const contribution of res.body.data as Array<{ collecteurId: string | null }>) {
      expect(contribution.collecteurId).toBe(collecteur.id)
    }

    const total = await prisma.contribution.count({ where: { collecteurId: collecteur.id } })
    expect(res.body.pagination).toEqual({
      page: 1,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    })
  })

  it('GET /api/contributions/:id/timeline returns the collector contribution traceability contract', async () => {
    const contribution = await prisma.contribution.findFirst({
      where: {
        collecteur: { role: 'COLLECTEUR', isActive: true },
      },
      include: { collecteur: true },
      orderBy: { createdAt: 'desc' },
    })
    if (!contribution?.collecteur) return

    const res = await request(app)
      .get(`/api/contributions/${contribution.id}/timeline`)
      .set(
        'Cookie',
        cookieFor(
          contribution.collecteur.id,
          contribution.collecteur.role,
          contribution.collecteur.email
        )
      )

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.contribution).toMatchObject({
      id: contribution.id,
      montant: contribution.montant,
      statut: contribution.statut,
    })
    expect(typeof res.body.data.contribution.membre).toBe('string')
    expect(typeof res.body.data.contribution.rubrique).toBe('string')
    expect(Array.isArray(res.body.data.timeline)).toBe(true)
    expect(res.body.data.timeline.length).toBeGreaterThan(0)
    for (const event of res.body.data.timeline as Array<Record<string, unknown>>) {
      expect(typeof event.step).toBe('string')
      expect(typeof event.label).toBe('string')
      expect(typeof event.actor).toBe('string')
      expect(typeof event.at).toBe('string')
    }
  })
})
