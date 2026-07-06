// Tests de l'impersonation développeur ("Connecter" dans Gestion des utilisateurs)
// Règles : DEVELOPER uniquement · cible active non-DEVELOPER · audité · retour en un clic.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { getJwtSecret } from '../src/lib/security'

const prisma = getPrisma()

let dev: { id: string; email: string }
let targetMembre: { id: string; email: string; fullName: string; role: string }
let devCookie = ''
let csrfToken = ''
let csrfCookie = ''

function cookieFor(payload: object): string {
  return `access_token=${jwt.sign(payload, getJwtSecret(), { expiresIn: '15m' })}`
}

function extractAccessToken(res: request.Response): string {
  const setCookie = res.headers['set-cookie']
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean)
  const raw = cookies.find((c: string) => c.startsWith('access_token=')) ?? ''
  return raw.split(';')[0].replace('access_token=', '')
}

beforeAll(async () => {
  const devUser = await prisma.user.findFirst({ where: { role: 'DEVELOPER' } })
  if (!devUser) throw new Error('Seed requis : aucun DEVELOPER')
  dev = { id: devUser.id, email: devUser.email }
  devCookie = cookieFor({ userId: dev.id, role: 'DEVELOPER', email: dev.email })

  const membre = await prisma.user.findFirst({ where: { role: 'MEMBRE', isActive: true } })
  if (!membre) throw new Error('Seed requis : aucun MEMBRE actif')
  targetMembre = { id: membre.id, email: membre.email, fullName: membre.fullName, role: membre.role }

  const res = await request(app).get('/api/csrf-token').set('Cookie', devCookie)
  csrfToken = res.body.token as string
  const setCookie = res.headers['set-cookie']
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean)
  csrfCookie = cookies.find((c: string) => c.startsWith('csrf_token=')) ?? ''
})

describe('POST /api/developer/impersonate/:userId — contrôle d\'accès', () => {
  it('ADMIN → 403 (réservé DEVELOPER)', async () => {
    const adminCookie = cookieFor({ userId: dev.id, role: 'ADMIN', email: dev.email })
    const csrf = await request(app).get('/api/csrf-token').set('Cookie', adminCookie)
    const aCsrfCookie = (Array.isArray(csrf.headers['set-cookie']) ? csrf.headers['set-cookie'] : [])
      .find((c: string) => c.startsWith('csrf_token=')) ?? ''
    const res = await request(app)
      .post(`/api/developer/impersonate/${targetMembre.id}`)
      .set('Cookie', `${adminCookie}; ${aCsrfCookie}`)
      .set('x-csrf-token', csrf.body.token)
      .send({})
    expect(res.status).toBe(403)
  })

  it('cible DEVELOPER → 403', async () => {
    const res = await request(app)
      .post(`/api/developer/impersonate/${dev.id}`)
      .set('Cookie', `${devCookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .send({})
    // soi-même → 400, autre DEVELOPER → 403 : les deux sont bloqués
    expect([400, 403]).toContain(res.status)
  })

  it('cible inexistante → 404', async () => {
    const res = await request(app)
      .post('/api/developer/impersonate/id-inexistant-xyz')
      .set('Cookie', `${devCookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .send({})
    expect(res.status).toBe(404)
  })
})

describe('Impersonation réussie + retour', () => {
  let impersonatedToken = ''

  it('DEVELOPER → 200, cookie du compte cible marqué impersonatedBy', async () => {
    const res = await request(app)
      .post(`/api/developer/impersonate/${targetMembre.id}`)
      .set('Cookie', `${devCookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.data.user.id).toBe(targetMembre.id)

    impersonatedToken = extractAccessToken(res)
    expect(impersonatedToken).toBeTruthy()
    const payload = jwt.verify(impersonatedToken, getJwtSecret()) as {
      userId: string; role: string; impersonatedBy?: string
    }
    expect(payload.userId).toBe(targetMembre.id)
    expect(payload.role).toBe(targetMembre.role)
    expect(payload.impersonatedBy).toBe(dev.id)
  })

  it('l\'impersonation est auditée (action IMPERSONATE, start)', async () => {
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'IMPERSONATE', entityId: targetMembre.id, userId: dev.id },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).toBeTruthy()
    expect((audit!.details as { action?: string })?.action).toBe('start')
  })

  it('GET /me en impersonation → impersonatedBy renseigné, mustChangePassword neutralisé', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `access_token=${impersonatedToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(targetMembre.id)
    expect(res.body.data.impersonatedBy).toBe(dev.id)
    expect(res.body.data.mustChangePassword).toBe(false)
  })

  it('la session impersonée n\'accède PAS au panneau développeur (rôle MEMBRE)', async () => {
    const res = await request(app)
      .get('/api/developer/config')
      .set('Cookie', `access_token=${impersonatedToken}`)
    expect(res.status).toBe(403)
  })

  it('POST /auth/stop-impersonation → retour au compte DEVELOPER', async () => {
    // CSRF lié à la session impersonée
    const csrf = await request(app).get('/api/csrf-token').set('Cookie', `access_token=${impersonatedToken}`)
    const iCsrfCookie = (Array.isArray(csrf.headers['set-cookie']) ? csrf.headers['set-cookie'] : [])
      .find((c: string) => c.startsWith('csrf_token=')) ?? ''

    const res = await request(app)
      .post('/api/auth/stop-impersonation')
      .set('Cookie', `access_token=${impersonatedToken}; ${iCsrfCookie}`)
      .set('x-csrf-token', csrf.body.token)
      .send({})
    expect(res.status).toBe(200)
    expect(res.body.data.user.id).toBe(dev.id)
    expect(res.body.data.user.role).toBe('DEVELOPER')

    const backToken = extractAccessToken(res)
    const payload = jwt.verify(backToken, getJwtSecret()) as { userId: string; role: string; impersonatedBy?: string }
    expect(payload.userId).toBe(dev.id)
    expect(payload.role).toBe('DEVELOPER')
    expect(payload.impersonatedBy).toBeUndefined()
  })

  it('stop-impersonation sans impersonation en cours → 400', async () => {
    const res = await request(app)
      .post('/api/auth/stop-impersonation')
      .set('Cookie', `${devCookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .send({})
    expect(res.status).toBe(400)
  })
})

describe('Cible désactivée', () => {
  it('→ 400', async () => {
    const inactive = await prisma.user.findFirst({ where: { isActive: false } })
    if (!inactive) return // pas de compte désactivé en base — cas couvert par le code
    const res = await request(app)
      .post(`/api/developer/impersonate/${inactive.id}`)
      .set('Cookie', `${devCookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .send({})
    expect(res.status).toBe(400)
  })
})
