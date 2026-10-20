// Point important n° 14 : « mot de passe oublié » sans coordonnées personnelles,
// mots de passe de 10 caractères hors liste noire, verrouillage par compte.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { hashPassword } from '../src/lib/password'
import { passwordProblem } from '../src/lib/password-policy'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `mdp-${Date.now()}`
const GOOD = 'Melen-Chorale-2026'
let csrf = { cookie: '', token: '' }

async function account(tag: string) {
  return prisma.user.create({
    data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'T', fullName: `${tag} T`, email: `${RUN}-${tag}@test.local`, passwordHash: await hashPassword(GOOD), role: 'TRESORIER', mustChangePassword: false },
  })
}
const login = (email: string, password: string) =>
  request(app).post('/api/auth/login').set('Cookie', csrf.cookie).set('x-csrf-token', csrf.token).send({ email, password })

beforeAll(async () => {
  const res = await request(app).get('/api/csrf-token')
  csrf = { cookie: (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0], token: res.body.token }
})

describe('Règles des mots de passe', () => {
  it('trop court, sans chiffre, courant ou contenant l\'adresse : refusé', () => {
    expect(passwordProblem('Court1')).toMatch(/10 caractères/)
    expect(passwordProblem('SansAucunChiffre')).toMatch(/majuscule et un chiffre/)
    expect(passwordProblem('sansmajuscule2026')).toMatch(/majuscule et un chiffre/)
    expect(passwordProblem('Azerty123')).toMatch(/10 caractères/)
    expect(passwordProblem('Cameroun123')).toMatch(/courant/)
    expect(passwordProblem('Jean.dupont2026', { email: 'jean.dupont@exemple.cm' })).toMatch(/adresse e-mail/)
    expect(passwordProblem(GOOD)).toBeNull()
  })

  it('changement de mot de passe : la règle s\'applique côté serveur', async () => {
    const u = await account('chg')
    const cookie = await testCookie({ userId: u.id, role: 'TRESORIER', email: u.email })
    const c = await request(app).get('/api/csrf-token').set('Cookie', cookie)
    const cc = (c.headers['set-cookie'] as unknown as string[]).find(x => x.startsWith('csrf_token='))!.split(';')[0]
    const res = await request(app).post('/api/auth/change-password').set('Cookie', `${cookie}; ${cc}`).set('x-csrf-token', c.body.token)
      .send({ currentPassword: GOOD, newPassword: 'motdepasse1' })
    expect(res.status).toBe(400)
  })
})

describe('Verrouillage par compte', () => {
  it('5 échecs : compte bloqué, même avec le bon mot de passe ; message identique', async () => {
    const u = await account('lock')
    for (let i = 0; i < 5; i++) expect((await login(u.email, 'Mauvais-Essai-99')).status).toBe(401)
    const blocked = await login(u.email, GOOD)
    expect(blocked.status).toBe(401)
    const unknown = await login(`${RUN}-inconnu@test.local`, GOOD)
    expect(blocked.body.error.message).toBe(unknown.body.error.message)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).lockedUntil!.getTime()).toBeGreaterThan(Date.now())
  })

  it('après le délai : connexion possible, compteur remis à zéro', async () => {
    const u = await account('unlock')
    await prisma.user.update({ where: { id: u.id }, data: { failedLoginCount: 3, lockedUntil: new Date(Date.now() - 1000) } })
    expect((await login(u.email, GOOD)).status).toBe(200)
    expect(await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).toMatchObject({ failedLoginCount: 0, lockedUntil: null })
  })
})

describe('Mot de passe oublié', () => {
  it('contact générique, jamais les coordonnées d\'un administrateur', async () => {
    const res = await request(app).post('/api/auth/forgot-password').set('Cookie', csrf.cookie).set('x-csrf-token', csrf.token).send({ email: `${RUN}@test.local` })
    expect(res.status).toBe(200)
    expect(res.body.data.admin).toBeUndefined()
    expect(res.body.data.contact.label).toBeTruthy()
    const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'DEVELOPER'] } }, select: { email: true } })
    const body = JSON.stringify(res.body)
    expect(admins.some(a => body.includes(a.email))).toBe(false)
  })
})
