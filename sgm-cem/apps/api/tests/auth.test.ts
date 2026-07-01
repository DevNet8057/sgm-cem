import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'

// These tests run against the real Express app (no mocks).
// Login requires a CSRF token (as in the real frontend flow).

let csrfToken = ''
let csrfCookie = ''

beforeAll(async () => {
  const res = await request(app).get('/api/csrf-token')
  csrfToken = res.body.token as string
  // Extract the csrf_token cookie to include in subsequent requests
  const setCookie = res.headers['set-cookie']
  if (Array.isArray(setCookie)) {
    csrfCookie = setCookie.find(c => c.startsWith('csrf_token=')) ?? ''
  } else if (typeof setCookie === 'string' && setCookie.startsWith('csrf_token=')) {
    csrfCookie = setCookie
  }
})

describe('POST /api/auth/login', () => {
  it('rejects missing credentials with 400 (CSRF provided)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('x-csrf-token', csrfToken)
      .set('Cookie', csrfCookie)
      .send({})
    expect(res.status).toBe(400)
  })

  it('rejects invalid credentials with 401 (CSRF provided)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .set('x-csrf-token', csrfToken)
      .set('Cookie', csrfCookie)
      .send({ email: 'nobody@example.com', password: 'wrongpassword' })
    expect([400, 401, 429]).toContain(res.status)
  })

  it('returns 403 when CSRF token is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'nobody@example.com', password: 'wrongpassword' })
    expect(res.status).toBe(403)
  })
})

describe('GET /api/csrf-token', () => {
  it('returns a valid CSRF token (no CSRF check on GET)', async () => {
    const res = await request(app).get('/api/csrf-token')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('token')
    expect(typeof res.body.token).toBe('string')
    expect(res.body.token.length).toBeGreaterThan(10)
  })
})

describe('GET /api/health', () => {
  it('returns ok or error status', async () => {
    const res = await request(app).get('/api/health')
    expect([200, 503]).toContain(res.status)
    expect(res.body).toHaveProperty('status')
  })
})
