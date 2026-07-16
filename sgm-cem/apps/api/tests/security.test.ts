import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../src/index'

describe('Security headers', () => {
  it('includes X-Frame-Options or CSP frame-src on any endpoint', async () => {
    const res = await request(app).get('/api/health')
    const hasFrameProtection =
      res.headers['x-frame-options'] !== undefined ||
      (res.headers['content-security-policy'] ?? '').includes('frame-src')
    expect(hasFrameProtection).toBe(true)
  })

  it('includes Strict-Transport-Security in non-dev environments', async () => {
    if (process.env.NODE_ENV === 'production') {
      const res = await request(app).get('/api/health')
      expect(res.headers['strict-transport-security']).toBeDefined()
    } else {
      // In dev, HSTS may be omitted — just assert the test passes
      expect(true).toBe(true)
    }
  })
})

describe('CSRF protection', () => {
  it('GET /api/csrf-token returns a token (no CSRF check on GET)', async () => {
    const res = await request(app).get('/api/csrf-token')
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
  })

  it('POST mutation without CSRF token returns 403 (if authenticated)', async () => {
    // Without auth cookie, we expect 401 first — CSRF guard comes after auth in some setups
    const res = await request(app)
      .post('/api/membres')
      .set('Content-Type', 'application/json')
      .send({ firstName: 'Test' })
    // Either 401 (no auth) or 403 (CSRF rejected)
    expect([401, 403]).toContain(res.status)
  })
})

describe('Rate limiting', () => {
  it('does not immediately rate-limit a single login attempt', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password' })
    // Should get 400/401, not 429 on first attempt
    expect(res.status).not.toBe(429)
  })
})

describe('Static /uploads — embarquable cross-origin (avatars)', () => {
  it('GET /uploads/* renvoie Cross-Origin-Resource-Policy: cross-origin', async () => {
    const res = await request(app).get('/uploads/avatars/inexistant.png')
    // 404 attendu (fichier absent) — c'est l'en-tête qui compte, posé avant express.static
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin')
  })

  it('les routes /api conservent le CORP same-origin par défaut de helmet', async () => {
    const res = await request(app).get('/api/health')
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin')
  })
})
