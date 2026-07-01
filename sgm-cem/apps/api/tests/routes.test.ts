import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../src/index'

// All routes tested here require authentication.
// Without a valid HttpOnly cookie, the server must return 401.
// This verifies that no route accidentally skips the `authenticate` middleware.

const UNAUTH = [401, 403]

describe('Stats routes — auth guard', () => {
  it('GET /api/stats/dashboard requires auth', async () => {
    const res = await request(app).get('/api/stats/dashboard')
    expect(UNAUTH).toContain(res.status)
  })

  it('GET /api/stats/monthly requires auth', async () => {
    const res = await request(app).get('/api/stats/monthly')
    expect(UNAUTH).toContain(res.status)
  })
})

describe('Notifications routes — auth guard', () => {
  it('GET /api/notifications requires auth', async () => {
    const res = await request(app).get('/api/notifications')
    expect(UNAUTH).toContain(res.status)
  })

  it('PATCH /api/notifications/:id/read requires auth', async () => {
    const res = await request(app).patch('/api/notifications/nonexistent/read')
    expect(UNAUTH).toContain(res.status)
  })

  it('PATCH /api/notifications/read-all requires auth', async () => {
    const res = await request(app).patch('/api/notifications/read-all')
    expect(UNAUTH).toContain(res.status)
  })
})

describe('Settings routes — auth guard', () => {
  it('GET /api/settings requires auth', async () => {
    const res = await request(app).get('/api/settings')
    expect(UNAUTH).toContain(res.status)
  })

  it('PATCH /api/settings requires auth + CSRF', async () => {
    const res = await request(app)
      .patch('/api/settings')
      .send({ etudiantRatio: 0.5 })
    expect([401, 403]).toContain(res.status)
  })
})

describe('Prestations routes — auth guard', () => {
  it('GET /api/prestations requires auth', async () => {
    const res = await request(app).get('/api/prestations')
    expect(UNAUTH).toContain(res.status)
  })

  it('POST /api/prestations requires auth + CSRF', async () => {
    const res = await request(app)
      .post('/api/prestations')
      .send({ titre: 'Test' })
    expect([401, 403]).toContain(res.status)
  })

  it('GET /api/prestations/:id requires auth', async () => {
    const res = await request(app).get('/api/prestations/nonexistent')
    expect(UNAUTH).toContain(res.status)
  })
})

describe('Membres routes — auth guard', () => {
  it('GET /api/membres requires auth', async () => {
    const res = await request(app).get('/api/membres')
    expect(UNAUTH).toContain(res.status)
  })

  it('POST /api/membres requires auth + CSRF', async () => {
    const res = await request(app)
      .post('/api/membres')
      .send({ firstName: 'Jean', lastName: 'Test', email: 'jean@test.cm' })
    expect([401, 403]).toContain(res.status)
  })

  it('GET /api/membres/:id requires auth', async () => {
    const res = await request(app).get('/api/membres/nonexistent')
    expect(UNAUTH).toContain(res.status)
  })

  it('PATCH /api/membres/:id requires auth + CSRF', async () => {
    const res = await request(app)
      .patch('/api/membres/nonexistent')
      .send({ firstName: 'Jean' })
    expect([401, 403]).toContain(res.status)
  })
})

describe('Rubriques routes — auth guard', () => {
  it('GET /api/rubriques requires auth', async () => {
    const res = await request(app).get('/api/rubriques')
    expect(UNAUTH).toContain(res.status)
  })

  it('POST /api/rubriques requires auth + CSRF', async () => {
    const res = await request(app)
      .post('/api/rubriques')
      .send({ code: 'TST-2026', title: 'Test' })
    expect([401, 403]).toContain(res.status)
  })
})

describe('Collecteurs routes — auth guard', () => {
  it('GET /api/collecteurs requires auth', async () => {
    const res = await request(app).get('/api/collecteurs')
    expect(UNAUTH).toContain(res.status)
  })
})

describe('Commissions routes — auth guard', () => {
  it('GET /api/commissions requires auth', async () => {
    const res = await request(app).get('/api/commissions')
    expect(UNAUTH).toContain(res.status)
  })

  it('GET /api/commissions/:id/documents requires auth', async () => {
    const res = await request(app).get('/api/commissions/nonexistent/documents')
    expect(UNAUTH).toContain(res.status)
  })
})

describe('Profile routes — auth guard', () => {
  it('GET /api/profile requires auth', async () => {
    const res = await request(app).get('/api/profile')
    expect(UNAUTH).toContain(res.status)
  })
})

describe('Funds routes — auth guard', () => {
  it('GET /api/funds/overview requires auth', async () => {
    const res = await request(app).get('/api/funds/overview')
    expect(UNAUTH).toContain(res.status)
  })

  it('GET /api/funds/transfers requires auth', async () => {
    const res = await request(app).get('/api/funds/transfers')
    expect(UNAUTH).toContain(res.status)
  })
})
