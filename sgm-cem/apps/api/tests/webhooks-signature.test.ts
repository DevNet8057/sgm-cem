import crypto from 'crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { __clearConfigCacheForTests } from '../src/services/config.service'

const MTN_SECRET = 'mtn-webhook-test-secret'
const ORANGE_SECRET = 'orange-webhook-test-secret'
const previousMtnSecret = process.env.MTN_WEBHOOK_SECRET
const previousOrangeSecret = process.env.ORANGE_CLIENT_SECRET

function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(Buffer.from(payload)).digest('hex')
}

beforeEach(() => {
  __clearConfigCacheForTests()
  process.env.MTN_WEBHOOK_SECRET = MTN_SECRET
  process.env.ORANGE_CLIENT_SECRET = ORANGE_SECRET
})

afterAll(() => {
  if (previousMtnSecret === undefined) delete process.env.MTN_WEBHOOK_SECRET
  else process.env.MTN_WEBHOOK_SECRET = previousMtnSecret

  if (previousOrangeSecret === undefined) delete process.env.ORANGE_CLIENT_SECRET
  else process.env.ORANGE_CLIENT_SECRET = previousOrangeSecret

  __clearConfigCacheForTests()
})

describe('Webhooks MTN — signature HMAC obligatoire', () => {
  it('refuse le webhook si le secret est absent', async () => {
    delete process.env.MTN_WEBHOOK_SECRET

    const response = await request(app)
      .post('/api/webhooks/mtn')
      .set('Content-Type', 'application/json')
      .set('x-callback-signature', '0'.repeat(64))
      .send('{"status":"SUCCESSFUL"}')

    expect(response.status).toBe(401)
  })

  it('refuse le webhook si la signature est absente ou invalide', async () => {
    const unsigned = await request(app)
      .post('/api/webhooks/mtn')
      .set('Content-Type', 'application/json')
      .send('{"status":"SUCCESSFUL"}')

    const invalid = await request(app)
      .post('/api/webhooks/mtn')
      .set('Content-Type', 'application/json')
      .set('x-callback-signature', 'f'.repeat(64))
      .send('{"status":"SUCCESSFUL"}')

    expect(unsigned.status).toBe(401)
    expect(invalid.status).toBe(401)
  })

  it('accepte une signature calculée sur le payload brut exact', async () => {
    const rawPayload = '{ "status": "SUCCESSFUL" }'

    const response = await request(app)
      .post('/api/webhooks/mtn')
      .set('Content-Type', 'application/json')
      .set('x-callback-signature', sign(rawPayload, MTN_SECRET))
      .send(rawPayload)

    expect(response.status).toBe(200)
  })
})

describe('Webhooks Orange — signature HMAC obligatoire', () => {
  it('refuse le webhook si le secret est absent', async () => {
    delete process.env.ORANGE_CLIENT_SECRET

    const response = await request(app)
      .post('/api/webhooks/orange')
      .set('Content-Type', 'application/json')
      .set('x-orange-signature', '0'.repeat(64))
      .send('{"status":"SUCCESS"}')

    expect(response.status).toBe(401)
  })

  it('refuse le webhook si la signature est absente ou invalide', async () => {
    const unsigned = await request(app)
      .post('/api/webhooks/orange')
      .set('Content-Type', 'application/json')
      .send('{"status":"SUCCESS"}')

    const invalid = await request(app)
      .post('/api/webhooks/orange')
      .set('Content-Type', 'application/json')
      .set('x-orange-signature', 'f'.repeat(64))
      .send('{"status":"SUCCESS"}')

    expect(unsigned.status).toBe(401)
    expect(invalid.status).toBe(401)
  })

  it('accepte une signature calculée sur le payload brut exact', async () => {
    const rawPayload = '{ "status": "SUCCESS" }'

    const response = await request(app)
      .post('/api/webhooks/orange')
      .set('Content-Type', 'application/json')
      .set('x-orange-signature', `sha256=${sign(rawPayload, ORANGE_SECRET)}`)
      .send(rawPayload)

    expect(response.status).toBe(200)
  })
})
