import { describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { AppError, errorHandler } from '../src/middleware/errorHandler'
import { assertPayloadComplexity, payloadComplexityGuard } from '../src/middleware/payload-complexity'

function nestedPayload(depth: number): unknown {
  let payload: unknown = null
  for (let index = 0; index < depth; index += 1) payload = { child: payload }
  return payload
}

function expectComplexityError(payload: unknown): void {
  try {
    assertPayloadComplexity(payload)
    throw new Error('Le contenu aurait dû être refusé')
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ code: 'PAYLOAD_TOO_COMPLEX', statusCode: 413 })
  }
}

describe('Budget structurel des requêtes', () => {
  it('accepte un contenu JSON normal', () => {
    expect(() => assertPayloadComplexity({
      email: 'member@example.invalid',
      profile: { enabled: true, amount: 5000, tags: ['a', 'b'] },
    })).not.toThrow()
  })

  it('accepte exactement 1000 éléments dans un tableau', () => {
    expect(() => assertPayloadComplexity(Array(1000).fill(null))).not.toThrow()
  })

  it('refuse 1001 éléments avant de parcourir le tableau', () => {
    const payload = new Array(1001)
    Object.defineProperty(payload, 0, { get: () => { throw new Error('Ne pas lire les éléments') } })
    expectComplexityError(payload)
  })

  it('accepte la profondeur 32 et refuse la profondeur 33', () => {
    expect(() => assertPayloadComplexity(nestedPayload(32))).not.toThrow()
    expectComplexityError(nestedPayload(33))
  })

  it('accepte 10000 nœuds et refuse 10001 nœuds', () => {
    const payload = Array.from({ length: 1000 }, () => Array(9).fill(null))
    expectComplexityError(payload)
    payload[0].pop()
    expect(() => assertPayloadComplexity(payload)).not.toThrow()
  })

  it('conserve un import de 500 membres avec 10 champs chacun', () => {
    const member = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`field${index}`, 'value']))
    const payload = { membres: Array.from({ length: 500 }, () => ({ ...member })) }
    expect(() => assertPayloadComplexity(payload)).not.toThrow()
  })

  it('ne lance pas la validation suivante si le budget est dépassé', async () => {
    const validation = vi.fn()
    const app = express()
    app.use(express.json())
    app.use(payloadComplexityGuard)
    app.post('/validate', (_req, res) => {
      validation()
      res.json({ success: true })
    })
    app.use(errorHandler)

    const rejected = await request(app).post('/validate').send({ rows: Array(1001).fill(null) })
    expect(rejected.status).toBe(413)
    expect(rejected.body).toMatchObject({ success: false, error: { code: 'PAYLOAD_TOO_COMPLEX' } })
    expect(validation).not.toHaveBeenCalled()

    const accepted = await request(app).post('/validate').send({ rows: [1, 2, 3] })
    expect(accepted.status).toBe(200)
    expect(validation).toHaveBeenCalledTimes(1)
  })
})
