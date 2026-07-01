import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../src/index'

// Integration tests for contribution endpoints.
// Unauthenticated calls should be rejected; we test surface-level guards here.
// For full flow tests, seed a test DB and authenticate first.

describe('Contributions API — unauthenticated guards', () => {
  it('GET /api/contributions rejects without auth cookie (401)', async () => {
    const res = await request(app).get('/api/contributions')
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

  it('PATCH /api/contributions/:id/confirm rejects without auth (401)', async () => {
    const res = await request(app).patch('/api/contributions/fake-id/confirm').send()
    expect([401, 403]).toContain(res.status)
  })
})

describe('Webhooks — no auth required', () => {
  it('POST /api/webhooks/mtn with empty body returns 200 (silently ignored)', async () => {
    const res = await request(app)
      .post('/api/webhooks/mtn')
      .send({})
    expect(res.status).toBe(200)
  })

  it('POST /api/webhooks/orange with empty body returns 200 (silently ignored)', async () => {
    const res = await request(app)
      .post('/api/webhooks/orange')
      .send({})
    expect(res.status).toBe(200)
  })
})
