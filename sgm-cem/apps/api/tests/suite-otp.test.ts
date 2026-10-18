// Point important n° 11 (EF-M01-02) : numéros au format E.164, essais comptés
// de façon atomique (3 au plus), code expiré ou déjà utilisé refusé.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { hashOtpCode } from '../src/lib/otp'
import { isValidE164, toE164 } from '../src/lib/phone'

const prisma = getPrisma()
const RUN = `otp-${Date.now()}`
const LOCAL = `6${String(Date.now()).slice(-8)}`
const FULL = `+237${LOCAL}`
let csrf = { cookie: '', token: '' }

async function issue(code: string, expiresAt = new Date(Date.now() + 5 * 60_000)) {
  await prisma.otpCode.updateMany({ where: { phone: FULL, used: false }, data: { used: true } })
  return prisma.otpCode.create({ data: { phone: FULL, code: hashOtpCode(FULL, 'LOGIN', code), purpose: 'LOGIN', expiresAt } })
}

const verify = (phone: string, code: string) =>
  request(app).post('/api/auth/otp/verify').set('Cookie', csrf.cookie).set('x-csrf-token', csrf.token).send({ phone, code })

beforeAll(async () => {
  // Compte enregistré avec un ancien format local (avant normalisation)
  await prisma.user.create({
    data: { memberId: `${RUN}-u`, firstName: 'O', lastName: 'T', fullName: 'O T', email: `${RUN}@test.local`, phone: LOCAL, passwordHash: 'disabled', role: 'MEMBRE', mustChangePassword: false },
  })
  const res = await request(app).get('/api/csrf-token')
  csrf = { cookie: (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0], token: res.body.token }
})

describe('Numéros E.164', () => {
  it('formats camerounais et diaspora', () => {
    expect(toE164('677 12 34 56')).toBe('+237677123456')
    expect(toE164('237677123456')).toBe('+237677123456')
    expect(toE164('00237 677123456')).toBe('+237677123456')
    expect(toE164('+33 6 12 34 56 78')).toBe('+33612345678')
    expect(toE164('33612345678')).toBe('+33612345678')
    expect(isValidE164(toE164('67712'))).toBe(false)
    expect(isValidE164('+2376771234567')).toBe(false)
  })
})

describe('Vérification du code', () => {
  it('3 erreurs : le code est invalidé, même juste ensuite', async () => {
    await issue('111111')
    expect((await verify(LOCAL, '000000')).body.error.message).toMatch(/2 tentative/)
    expect((await verify(LOCAL, '000001')).body.error.message).toMatch(/1 tentative/)
    expect((await verify(LOCAL, '000002')).body.error.message).toMatch(/Demandez un nouveau code/)
    expect((await verify(LOCAL, '111111')).status).toBe(401)
  })

  it('essais simultanés : jamais plus de 3 comptés', async () => {
    const otp = await issue('222222')
    await Promise.all(Array.from({ length: 6 }, (_, i) => verify(LOCAL, `90000${i}`)))
    expect((await prisma.otpCode.findUniqueOrThrow({ where: { id: otp.id } })).attempts).toBeLessThanOrEqual(3)
  })

  it('bon code (saisi au format +237) : connexion ; rejeu refusé', async () => {
    await issue('333333')
    const ok = await verify(FULL, '333333')
    expect(ok.status).toBe(200)
    expect((await verify(FULL, '333333')).status).toBe(401)
  })

  it('code expiré refusé', async () => {
    await issue('444444', new Date(Date.now() - 1000))
    expect((await verify(LOCAL, '444444')).status).toBe(401)
  })
})
