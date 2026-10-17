// Non-régression de la phase 0 (sécurisation) : rejoue les preuves P2 à P5
// de l'audit du 17/10/2026 — elles doivent désormais ÉCHOUER côté attaquant.
// Fixtures créées ici (aucune dépendance au seed), aucun appel externe.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { openSession } from '../src/lib/session'
import { hashPassword, verifyPassword } from '../src/lib/password'
import { generateReceiptHtml } from '../src/services/receipt'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `p0-${Date.now()}`
let seq = 0

type Fixture = { id: string; role: string; email: string }

async function makeUser(role: string, extra: Record<string, unknown> = {}): Promise<Fixture> {
  seq += 1
  const email = `${RUN}-${seq}@test.local`
  return prisma.user.create({
    data: {
      memberId: `${RUN}-${seq}`, firstName: 'Test', lastName: `${role}${seq}`, fullName: `Test ${role}${seq}`,
      email, passwordHash: 'disabled', role: role as never, isActive: true, mustChangePassword: false, ...extra,
    },
    select: { id: true, role: true, email: true },
  })
}

async function csrf(cookie: string) {
  const res = await request(app).get('/api/csrf-token').set('Cookie', cookie)
  const csrfCookie = (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]
  return { cookie: `${cookie}; ${csrfCookie}`, token: res.body.token as string }
}

async function authed(user: Fixture) {
  return csrf(await testCookie({ userId: user.id, role: user.role, email: user.email }))
}

function cookiesOf(res: request.Response): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of (res.headers['set-cookie'] as unknown as string[] | undefined) ?? []) {
    const [pair] = c.split(';')
    const i = pair.indexOf('=')
    out[pair.slice(0, i)] = pair.slice(i + 1)
  }
  return out
}

let col1: Fixture, col2: Fixture, treso: Fixture, resp: Fixture
let membreId = ''
let rubriqueId = ''

beforeAll(async () => {
  ;[col1, col2, treso, resp] = await Promise.all([
    makeUser('COLLECTEUR'), makeUser('COLLECTEUR'), makeUser('TRESORIER'), makeUser('RESPONSABLE'),
  ])
  const membreUser = await makeUser('MEMBRE')
  const membre = await prisma.membre.create({
    data: { userId: membreUser.id, memberId: `${RUN}-m`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE', profilFinancier: 'TRAVAILLEUR' },
  })
  membreId = membre.id
  const rubrique = await prisma.rubrique.create({
    data: {
      code: `${RUN}-R`, title: 'Rubrique de test', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(),
      createdById: treso.id, createdByName: 'Test',
    },
  })
  rubriqueId = rubrique.id
})

afterAll(async () => {
  await prisma.contribution.deleteMany({ where: { rubriqueId } }).catch(() => {})
})

describe('P3 — circuit des fonds', () => {
  it('« Réceptionner » (claim) et « Vers caisse/banque » sont retirés', async () => {
    const s = await authed(col2)
    const claim = await request(app).patch('/api/collecteurs/claim').set('Cookie', s.cookie).set('x-csrf-token', s.token).send({ contributionIds: ['x'] })
    expect(claim.status).toBe(410)
    const legacy = await request(app).patch('/api/collecteurs/transfer').set('Cookie', s.cookie).set('x-csrf-token', s.token).send({})
    expect(legacy.status).toBe(410)
  })

  it('un collecteur ne peut pas remettre les fonds détenus par un autre', async () => {
    const c = await prisma.contribution.create({ data: { membreId, rubriqueId, collecteurId: col1.id, montant: 5000, modePaiement: 'ESPECES', statut: 'CONFIRME', localisationFonds: 'CHEZ_COLLECTEUR' } })
    const s = await authed(col2)
    const res = await request(app).post('/api/funds/transfer').set('Cookie', s.cookie).set('x-csrf-token', s.token)
      .send({ receiverId: treso.id, contributionIds: [c.id] })
    expect(res.status).toBe(403)
    const after = await prisma.contribution.findUniqueOrThrow({ where: { id: c.id } })
    expect(after.localisationFonds).toBe('CHEZ_COLLECTEUR')
  })

  it('un responsable ne peut pas non plus déplacer les fonds d\'un collecteur', async () => {
    const c = await prisma.contribution.create({ data: { membreId, rubriqueId, collecteurId: col1.id, montant: 2000, modePaiement: 'ESPECES', statut: 'CONFIRME', localisationFonds: 'CHEZ_COLLECTEUR' } })
    const s = await authed(resp)
    const res = await request(app).post('/api/funds/transfer').set('Cookie', s.cookie).set('x-csrf-token', s.token)
      .send({ receiverId: treso.id, contributionIds: [c.id] })
    expect(res.status).toBe(403)
  })
})

describe('P4 — confirmation manuelle', () => {
  it('un paiement Mobile Money ne se confirme pas à la main', async () => {
    const momo = await prisma.contribution.create({ data: { membreId, rubriqueId, collecteurId: col1.id, montant: 7000, modePaiement: 'MTN_MOMO', statut: 'EN_ATTENTE_CONFIRMATION', paymentStatus: 'PROCESSING', localisationFonds: 'EN_TRANSIT', externalTransactionId: `${RUN}-never-paid` } })
    const s = await authed(col1)
    const res = await request(app).patch(`/api/contributions/${momo.id}/confirm`).set('Cookie', s.cookie).set('x-csrf-token', s.token)
    expect(res.status).toBe(403)
    const after = await prisma.contribution.findUniqueOrThrow({ where: { id: momo.id } })
    expect(after.statut).toBe('EN_ATTENTE_CONFIRMATION')
  })

  it('le trésorier ne confirme pas les espèces d\'un autre collecteur (RG-14)', async () => {
    const cash = await prisma.contribution.create({ data: { membreId, rubriqueId, collecteurId: col1.id, montant: 1000, modePaiement: 'ESPECES', statut: 'EN_ATTENTE_CONFIRMATION' } })
    const s = await authed(treso)
    const res = await request(app).patch(`/api/contributions/${cash.id}/confirm`).set('Cookie', s.cookie).set('x-csrf-token', s.token)
    expect(res.status).toBe(403)
  })

  it('le collecteur désigné confirme ses espèces, une seule fois', async () => {
    const cash = await prisma.contribution.create({ data: { membreId, rubriqueId, collecteurId: col1.id, montant: 1500, modePaiement: 'ESPECES', statut: 'EN_ATTENTE_CONFIRMATION' } })
    const s = await authed(col1)
    const ok = await request(app).patch(`/api/contributions/${cash.id}/confirm`).set('Cookie', s.cookie).set('x-csrf-token', s.token)
    expect(ok.status).toBe(200)
    const again = await request(app).patch(`/api/contributions/${cash.id}/confirm`).set('Cookie', s.cookie).set('x-csrf-token', s.token)
    expect(again.status).toBe(400)
  }, 60_000)

  it('refus distinct du litige ; litige réservé au niveau 3', async () => {
    const cash = await prisma.contribution.create({ data: { membreId, rubriqueId, collecteurId: col1.id, montant: 900, modePaiement: 'ESPECES', statut: 'EN_ATTENTE_CONFIRMATION' } })
    const s = await authed(col1)
    const litige = await request(app).patch(`/api/contributions/${cash.id}/litige`).set('Cookie', s.cookie).set('x-csrf-token', s.token).send({ motif: 'Montant différent du reçu' })
    expect(litige.status).toBe(403)
    const refuse = await request(app).patch(`/api/contributions/${cash.id}/refuse`).set('Cookie', s.cookie).set('x-csrf-token', s.token).send({ motif: 'Argent jamais remis au collecteur' })
    expect(refuse.status).toBe(200)
    expect(refuse.body.data.statut).toBe('ANNULE')
  })

  it('le staff ne saisit pas un paiement MoMo/carte « à la main »', async () => {
    const s = await authed(col1)
    const res = await request(app).post('/api/contributions').set('Cookie', s.cookie).set('x-csrf-token', s.token)
      .send({ membreId, rubriqueId, montant: 1000, modePaiement: 'MTN_MOMO' })
    expect(res.status).toBe(400)
  })

  it('un collecteur ne voit que ses propres contributions', async () => {
    await prisma.contribution.create({ data: { membreId, rubriqueId, collecteurId: col1.id, montant: 300, modePaiement: 'ESPECES', statut: 'EN_ATTENTE_CONFIRMATION' } })
    const s = await authed(col2)
    const res = await request(app).get('/api/contributions/validations').set('Cookie', s.cookie)
    expect(res.status).toBe(200)
    expect((res.body.data as Array<{ collecteurId: string }>).every(c => c.collecteurId === col2.id)).toBe(true)
  })
})

describe('P5 — sessions', () => {
  it('un compte désactivé ne peut plus rafraîchir sa session', async () => {
    const victim = await makeUser('MEMBRE')
    const { refreshToken } = await openSession(victim, prisma)
    await prisma.user.update({ where: { id: victim.id }, data: { isActive: false } })
    const s = await csrf(`refresh_token=${refreshToken}`)
    const res = await request(app).post('/api/auth/refresh').set('Cookie', s.cookie).set('x-csrf-token', s.token)
    expect(res.status).toBe(401)
  })

  it('désactivation par l\'admin → jeton d\'accès refusé immédiatement', async () => {
    const admin = await makeUser('ADMIN')
    const victim = await makeUser('COLLECTEUR')
    const victimCookie = await testCookie({ userId: victim.id, role: victim.role, email: victim.email })
    expect((await request(app).get('/api/auth/me').set('Cookie', victimCookie)).status).toBe(200)
    const s = await authed(admin)
    const toggle = await request(app).patch(`/api/users/${victim.id}/toggle-active`).set('Cookie', s.cookie).set('x-csrf-token', s.token)
    expect(toggle.status).toBe(200)
    expect((await request(app).get('/api/auth/me').set('Cookie', victimCookie)).status).toBe(401)
  })

  it('rotation : un ancien refresh token rejoué après la fenêtre de grâce révoque la session', async () => {
    const user = await makeUser('MEMBRE')
    const { refreshToken, sessionId } = await openSession(user, prisma)
    const s = await csrf(`refresh_token=${refreshToken}`)
    const first = await request(app).post('/api/auth/refresh').set('Cookie', s.cookie).set('x-csrf-token', s.token)
    expect(first.status).toBe(200)
    expect(cookiesOf(first).refresh_token).toBeTruthy()
    expect(cookiesOf(first).refresh_token).not.toBe(refreshToken)
    // Simule un rejeu tardif de l'ancien jeton (vol)
    await prisma.userSession.update({ where: { id: sessionId }, data: { rotatedAt: new Date(Date.now() - 60_000) } })
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', s.cookie).set('x-csrf-token', s.token)
    expect(replay.status).toBe(401)
    expect(await prisma.userSession.count({ where: { id: sessionId } })).toBe(0)
  })

  it('jeton sans session (forgé ou antérieur) → 401', async () => {
    const jwt = (await import('jsonwebtoken')).default
    const { getJwtSecret } = await import('../src/lib/security')
    const user = await makeUser('ADMIN')
    const token = jwt.sign({ userId: user.id, role: 'ADMIN', email: user.email }, getJwtSecret(), { expiresIn: '15m' })
    expect((await request(app).get('/api/auth/me').set('Cookie', `access_token=${token}`)).status).toBe(401)
  })
})

describe('0.2 — mots de passe', () => {
  it('mot de passe temporaire : seules les routes /auth restent accessibles', async () => {
    const user = await makeUser('TRESORIER', { mustChangePassword: true })
    const cookie = await testCookie({ userId: user.id, role: user.role, email: user.email })
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200)
    const blocked = await request(app).get('/api/contributions').set('Cookie', cookie)
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
  })

  it('un ancien hachage bcrypt reste valide et migre vers Argon2id à la connexion', async () => {
    const legacy = await bcrypt.hash('Ancien-Mot2passe', 10)
    const user = await makeUser('MEMBRE', { passwordHash: legacy })
    const s = await csrf('')
    const res = await request(app).post('/api/auth/login').set('Cookie', s.cookie).set('x-csrf-token', s.token)
      .send({ email: user.email, password: 'Ancien-Mot2passe' })
    expect(res.status).toBe(200)
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.passwordHash.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword('Ancien-Mot2passe', after.passwordHash)).toBe(true)
  })

  it('« disabled » ou hachage inconnu ne valide jamais', async () => {
    expect(await verifyPassword('disabled', 'disabled')).toBe(false)
    expect(await verifyPassword('x', await hashPassword('y'))).toBe(false)
  })

  it('« mot de passe oublié » répond pareil pour un compte inconnu et un administrateur', async () => {
    const admin = await makeUser('ADMIN')
    const ask = async (email: string) => {
      const s = await csrf('')
      return request(app).post('/api/auth/forgot-password').set('Cookie', s.cookie).set('x-csrf-token', s.token).send({ email })
    }
    const a = await ask(admin.email)
    const b = await ask(`inconnu-${RUN}@test.local`)
    expect(a.status).toBe(200)
    expect(a.body).toEqual(b.body)
  })
})

describe('0.7 — code OTP', () => {
  it('le code est stocké haché, jamais en clair', async () => {
    const phone = `6${String(Date.now()).slice(-8)}`
    await makeUser('MEMBRE', { phone })
    const s = await csrf('')
    const res = await request(app).post('/api/auth/otp/request').set('Cookie', s.cookie).set('x-csrf-token', s.token).send({ phone })
    expect(res.status).toBe(200)
    const otp = await prisma.otpCode.findFirstOrThrow({ where: { phone: `+237${phone}` }, orderBy: { createdAt: 'desc' } })
    expect(otp.code).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('P2 — documents PDF', () => {
  it('le HTML du reçu échappe les données saisies', async () => {
    const ext = await prisma.contributeurExterne.create({ data: { nom: '<img src="http://169.254.169.254/x">Jean', phone: '+237670000999' } })
    const c = await prisma.contribution.create({ data: { contributeurExterneId: ext.id, rubriqueId, montant: 100, modePaiement: 'MTN_MOMO', statut: 'CONFIRME' } })
    const html = await generateReceiptHtml(c.id)
    expect(html).not.toContain('<img src="http://169.254.169.254/x">')
    expect(html).toContain('&lt;img')
  })
})
