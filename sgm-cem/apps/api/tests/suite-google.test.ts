// Reste à faire n° 2 : connexion Google — adresse vérifiée par Google exigée,
// compte rattaché à l'identifiant Google (sub) dès la première connexion.
// Le fournisseur est simulé : aucun appel réel à Google.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { OAuth2Client, type LoginTicket } from 'google-auth-library'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'

const prisma = getPrisma()
const RUN = `ggl-${Date.now()}`
const EMAIL = `${RUN}@test.local`
let userId = ''
let csrf = { cookie: '', token: '' }
const googleClientIdBefore = process.env.GOOGLE_CLIENT_ID

function fakeGoogle(payload: Record<string, unknown>) {
  vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({ getPayload: () => payload } as unknown as LoginTicket as never)
}

const login = () => request(app).post('/api/auth/google').set('Cookie', csrf.cookie).set('x-csrf-token', csrf.token).send({ idToken: 'jeton-simule' })

beforeAll(async () => {
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? 'test-client.apps.googleusercontent.com'
  userId = (await prisma.user.create({
    data: { memberId: `${RUN}-u`, firstName: 'G', lastName: 'T', fullName: 'G T', email: EMAIL, passwordHash: 'disabled', role: 'MEMBRE', mustChangePassword: false },
  })).id
  const res = await request(app).get('/api/csrf-token')
  csrf = { cookie: (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0], token: res.body.token }
})

afterAll(() => {
  vi.restoreAllMocks()
  if (googleClientIdBefore === undefined) delete process.env.GOOGLE_CLIENT_ID
})

describe('POST /api/auth/google', () => {
  it('refuse une adresse non vérifiée par Google', async () => {
    fakeGoogle({ email: EMAIL, email_verified: false, sub: `${RUN}-sub-1` })
    const res = await login()
    expect(res.status).toBe(403)
    expect(res.body.error.message).toMatch(/non vérifiée/)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).googleSub).toBeNull()
  })

  it('première connexion vérifiée : session ouverte et identifiant Google rattaché', async () => {
    fakeGoogle({ email: EMAIL, email_verified: true, sub: `${RUN}-sub-1` })
    const res = await login()
    expect(res.status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).googleSub).toBe(`${RUN}-sub-1`)
  })

  it('une autre identité Google portant la même adresse est refusée', async () => {
    fakeGoogle({ email: EMAIL, email_verified: true, sub: `${RUN}-sub-2` })
    const res = await login()
    expect(res.status).toBe(403)
    expect(res.body.error.message).toMatch(/autre compte Google/)
  })

  it('adresse inconnue : aucun compte créé', async () => {
    fakeGoogle({ email: `${RUN}-inconnu@test.local`, email_verified: true, sub: `${RUN}-sub-3` })
    expect((await login()).status).toBe(403)
    expect(await prisma.user.count({ where: { email: `${RUN}-inconnu@test.local` } })).toBe(0)
  })
})
