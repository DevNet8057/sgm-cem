// Tests Web Push — abonnement navigateur + clé VAPID + purge
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { getJwtSecret } from '../src/lib/security'
import { loadConfigCache } from '../src/services/config.service'
import { sendPushToUser } from '../src/services/push.service'

const prisma = getPrisma()
const FAKE_ENDPOINT = 'https://push.example.com/fake-endpoint-test-sgm'

let userId = ''
let cookie = ''
let csrfToken = ''
let csrfCookie = ''

beforeAll(async () => {
  // Le cache config n'est pas chargé automatiquement en NODE_ENV=test
  await loadConfigCache()

  const user = await prisma.user.findFirst({ where: { isActive: true } })
  if (!user) throw new Error('Seed requis')
  userId = user.id
  cookie = `access_token=${jwt.sign({ userId: user.id, role: user.role, email: user.email }, getJwtSecret(), { expiresIn: '15m' })}`

  const res = await request(app).get('/api/csrf-token').set('Cookie', cookie)
  csrfToken = res.body.token
  const setCookie = res.headers['set-cookie']
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean)
  csrfCookie = cookies.find((c: string) => c.startsWith('csrf_token=')) ?? ''

  await prisma.pushSubscription.deleteMany({ where: { endpoint: FAKE_ENDPOINT } })
})

afterAll(async () => {
  await prisma.pushSubscription.deleteMany({ where: { endpoint: FAKE_ENDPOINT } })
})

describe('GET /api/notifications/push/public-key', () => {
  it('sans auth → 401', async () => {
    const res = await request(app).get('/api/notifications/push/public-key')
    expect(res.status).toBe(401)
  })

  it('authentifié → clé publique VAPID (seedée en base)', async () => {
    const res = await request(app).get('/api/notifications/push/public-key').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(typeof res.body.data.publicKey).toBe('string')
    expect(res.body.data.publicKey.length).toBeGreaterThan(40)
  })
})

describe('POST /api/notifications/push/subscribe', () => {
  it('enregistre l\'abonnement du navigateur', async () => {
    const res = await request(app)
      .post('/api/notifications/push/subscribe')
      .set('Cookie', `${cookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .send({ endpoint: FAKE_ENDPOINT, keys: { p256dh: 'test-p256dh', auth: 'test-auth' } })
    expect(res.status).toBe(201)

    const sub = await prisma.pushSubscription.findUnique({ where: { endpoint: FAKE_ENDPOINT } })
    expect(sub).toBeTruthy()
    expect(sub!.userId).toBe(userId)
  })

  it('re-souscrire depuis le même navigateur = upsert (pas de doublon)', async () => {
    const res = await request(app)
      .post('/api/notifications/push/subscribe')
      .set('Cookie', `${cookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .send({ endpoint: FAKE_ENDPOINT, keys: { p256dh: 'nouveau-p256dh', auth: 'nouveau-auth' } })
    expect(res.status).toBe(201)

    const count = await prisma.pushSubscription.count({ where: { endpoint: FAKE_ENDPOINT } })
    expect(count).toBe(1)
    const sub = await prisma.pushSubscription.findUnique({ where: { endpoint: FAKE_ENDPOINT } })
    expect(sub!.p256dh).toBe('nouveau-p256dh')
  })

  it('endpoint invalide → 400', async () => {
    const res = await request(app)
      .post('/api/notifications/push/subscribe')
      .set('Cookie', `${cookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .send({ endpoint: 'pas-une-url', keys: { p256dh: 'x', auth: 'y' } })
    expect(res.status).toBe(400)
  })
})

describe('sendPushToUser — robustesse', () => {
  it('purge l\'abonnement expiré (le faux endpoint échoue) sans jeter', async () => {
    // Le faux endpoint va échouer — la fonction ne doit JAMAIS jeter
    await expect(sendPushToUser(userId, { title: 'Test', body: 'x' })).resolves.toBeUndefined()
  })
})

describe('DELETE /api/notifications/push/subscribe', () => {
  it('désabonne le navigateur courant', async () => {
    // Ré-enregistrer d'abord (le test précédent a pu purger le faux endpoint)
    await request(app)
      .post('/api/notifications/push/subscribe')
      .set('Cookie', `${cookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .send({ endpoint: FAKE_ENDPOINT, keys: { p256dh: 'x', auth: 'y' } })

    const res = await request(app)
      .delete('/api/notifications/push/subscribe')
      .set('Cookie', `${cookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .send({ endpoint: FAKE_ENDPOINT })
    expect(res.status).toBe(200)

    const sub = await prisma.pushSubscription.findUnique({ where: { endpoint: FAKE_ENDPOINT } })
    expect(sub).toBeNull()
  })
})
