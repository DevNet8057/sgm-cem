// Tests des routes du panneau développeur (DEVELOPER_PANEL_SGM_CEM.md §4-§5)
// Règle non négociable vérifiée ici : requireDeveloper strict — même ADMIN → 403.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { getConfig } from '../src/services/config.service'
import { testCookie } from './helpers/session'
import { hashPassword } from '../src/lib/password'

const prisma = getPrisma()
const MASK = '••••••••'

let devUser: { id: string; email: string }
let devCookie = ''
let adminCookie = ''
let csrfToken = ''
let csrfCookie = ''
let originalWebhookUrl: string | null = null
let originalLogLevel: string | null = null
let originalSmtpPass: string | null = null
// Clés créées pour le test (absentes de la base) : supprimées à la fin — le test
// ne dépend plus des vraies clés et n'en laisse aucune de factice derrière lui.
const createdKeys: string[] = []

async function ensureConfig(key: string, value: string, category: 'INTEGRATION_KEYS' | 'SYSTEM_BEHAVIOR' | 'WEBHOOKS' | 'NOTIFICATIONS', isSecret = false) {
  const existing = await prisma.systemConfig.findUnique({ where: { key } })
  if (existing) return
  await prisma.systemConfig.create({ data: { key, value, category, label: `[test] ${key}`, isSecret } })
  createdKeys.push(key)
}

function authCookieFor(userId: string, role: string, email: string): Promise<string> {
  return testCookie({ userId, role, email })
}

beforeAll(async () => {
  const dev = await prisma.user.findFirst({ where: { role: 'DEVELOPER' } })
  if (!dev) throw new Error('Seed requis : exécuter prisma/seed-config.ts (élévation DEVELOPER)')
  await ensureConfig('YELII_COLLECT_API_KEY', 'cle-factice-de-test', 'INTEGRATION_KEYS', true)
  await ensureConfig('SMTP_PASS', 'mdp-factice-de-test', 'NOTIFICATIONS', true)
  await ensureConfig('LOG_LEVEL', 'info', 'SYSTEM_BEHAVIOR')
  await ensureConfig('YELII_WEBHOOK_URL', 'https://exemple.test/webhooks/yelii', 'WEBHOOKS')
  devUser = { id: dev.id, email: dev.email }
  devCookie = await authCookieFor(dev.id, 'DEVELOPER', dev.email)
  // Un jeton avec rôle ADMIN (peu importe l'utilisateur : le RBAC lit le JWT)
  adminCookie = await authCookieFor(dev.id, 'ADMIN', dev.email)

  // Jeton CSRF lié à la session du développeur (double-submit cookie)
  const res = await request(app).get('/api/csrf-token').set('Cookie', devCookie)
  csrfToken = res.body.token as string
  const setCookie = res.headers['set-cookie']
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean)
  csrfCookie = cookies.find((c: string) => c.startsWith('csrf_token=')) ?? ''

  // Sauvegarder les valeurs pour restauration
  originalWebhookUrl = (await prisma.systemConfig.findUnique({ where: { key: 'YELII_WEBHOOK_URL' } }))?.value ?? null
  originalLogLevel = (await prisma.systemConfig.findUnique({ where: { key: 'LOG_LEVEL' } }))?.value ?? null
  originalSmtpPass = (await prisma.systemConfig.findUnique({ where: { key: 'SMTP_PASS' } }))?.value ?? null
})

afterAll(async () => {
  // Restaurer les valeurs modifiées par les tests
  if (originalWebhookUrl) {
    await prisma.systemConfig.update({ where: { key: 'YELII_WEBHOOK_URL' }, data: { value: originalWebhookUrl } })
  }
  if (originalLogLevel) {
    await prisma.systemConfig.update({ where: { key: 'LOG_LEVEL' }, data: { value: originalLogLevel } })
  }
  if (originalSmtpPass) {
    await prisma.systemConfig.update({ where: { key: 'SMTP_PASS' }, data: { value: originalSmtpPass } })
  }
  await prisma.systemConfigHistory.deleteMany({ where: { reason: { contains: '[test-dev-routes]' } } })
  if (createdKeys.length) {
    await prisma.systemConfigHistory.deleteMany({ where: { configKey: { in: createdKeys } } }).catch(() => {})
    await prisma.systemConfig.deleteMany({ where: { key: { in: createdKeys } } })
  }
})

describe('Panneau développeur — contrôle d\'accès strict', () => {
  it('sans authentification → 401', async () => {
    const res = await request(app).get('/api/developer/config')
    expect(res.status).toBe(401)
  })

  it('ADMIN → 403 (requireDeveloper, jamais requireLevel(5))', async () => {
    const res = await request(app).get('/api/developer/config').set('Cookie', adminCookie)
    expect(res.status).toBe(403)
  })

  it('TRESORIER → 403', async () => {
    const cookie = await authCookieFor(devUser.id, 'TRESORIER', devUser.email)
    const res = await request(app).get('/api/developer/config').set('Cookie', cookie)
    expect(res.status).toBe(403)
  })

  it('DEVELOPER → 200', async () => {
    const res = await request(app).get('/api/developer/config').set('Cookie', devCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    // Toutes les clés en base sont listées (le nombre dépend de l'environnement),
    // suivies des réglages du catalogue encore absents (isSet: false)
    expect(res.body.data.filter((c: { isSet: boolean }) => c.isSet).length).toBe(await prisma.systemConfig.count())
  })
})

describe('GET /api/developer/config — secrets masqués', () => {
  it('les clés isSecret sont renvoyées masquées (••••), jamais en clair', async () => {
    const res = await request(app).get('/api/developer/config').set('Cookie', devCookie)
    const yeliiKey = res.body.data.find((c: { key: string }) => c.key === 'YELII_COLLECT_API_KEY')
    expect(yeliiKey).toBeDefined()
    expect(yeliiKey.isSecret).toBe(true)
    expect(yeliiKey.value).toBe(MASK)
    // Aucune valeur secrète en clair dans toute la réponse
    const secrets = res.body.data.filter((c: { isSecret: boolean }) => c.isSecret)
    expect(secrets.every((c: { value: string; isSet: boolean }) => c.value === (c.isSet ? MASK : ''))).toBe(true)
  })

  it('JWT_SECRET / REFRESH_TOKEN_SECRET / DATABASE_URL ne sont PAS dans la liste', async () => {
    const res = await request(app).get('/api/developer/config').set('Cookie', devCookie)
    const keys = res.body.data.map((c: { key: string }) => c.key)
    expect(keys).not.toContain('JWT_SECRET')
    expect(keys).not.toContain('REFRESH_TOKEN_SECRET')
    expect(keys).not.toContain('CSRF_SECRET')
    expect(keys).not.toContain('DATABASE_URL')
  })
})

describe('PUT /api/developer/config/:key — modification à effet immédiat', () => {
  it('modifie LOG_LEVEL et le cache sert la nouvelle valeur sans redémarrage', async () => {
    const res = await request(app)
      .put('/api/developer/config/LOG_LEVEL')
      .set('Cookie', `${devCookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .send({ value: 'debug', reason: '[test-dev-routes] passage en debug' })
    expect(res.status).toBe(200)
    // Effet immédiat dans le même process — c'est le cœur de la fonctionnalité
    expect(getConfig('LOG_LEVEL')).toBe('debug')
  })

  it('refuse un secret d\'authentification (JWT_SECRET) → 403', async () => {
    const res = await request(app)
      .put('/api/developer/config/JWT_SECRET')
      .set('Cookie', `${devCookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .send({ value: 'hack' })
    expect(res.status).toBe(403)
  })

  it('clé inconnue → 404', async () => {
    const res = await request(app)
      .put('/api/developer/config/CLE_INCONNUE_XYZ')
      .set('Cookie', `${devCookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .send({ value: 'x' })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/developer/config/webhook/recalculate — §4', () => {
  it('construit l\'URL complète, l\'enregistre et le cache la sert immédiatement', async () => {
    const res = await request(app)
      .post('/api/developer/config/webhook/recalculate')
      .set('Cookie', `${devCookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .send({ newBaseUrl: 'https://nouveau-tunnel.example.com/', reason: '[test-dev-routes] recalcul' })
    expect(res.status).toBe(200)
    // Slash final retiré + chemin /webhooks/yelii ajouté
    expect(res.body.data.webhookUrl).toBe('https://nouveau-tunnel.example.com/webhooks/yelii')
    expect(res.body.data.manualActionRequired).toContain('yelii')
    // Effet immédiat : le service Yelii lira cette URL au prochain appel
    expect(getConfig('YELII_WEBHOOK_URL')).toBe('https://nouveau-tunnel.example.com/webhooks/yelii')
  })

  it('rejette une URL invalide → 400', async () => {
    const res = await request(app)
      .post('/api/developer/config/webhook/recalculate')
      .set('Cookie', `${devCookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .send({ newBaseUrl: 'pas-une-url' })
    expect(res.status).toBe(400)
  })
})

describe('Historique + révélation de secret', () => {
  it('GET /config/YELII_WEBHOOK_URL/history contient le recalcul', async () => {
    const res = await request(app)
      .get('/api/developer/config/YELII_WEBHOOK_URL/history')
      .set('Cookie', devCookie)
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThanOrEqual(1)
    expect(res.body.data[0].newValue).toBe('https://nouveau-tunnel.example.com/webhooks/yelii')
    expect(res.body.data[0].changedByName).toBeTruthy()
  })

  it('l\'historique d\'une clé secrète est masqué', async () => {
    // Créer un changement sur une clé secrète pour vérifier le masquage
    await request(app)
      .put('/api/developer/config/SMTP_PASS')
      .set('Cookie', `${devCookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrfToken)
      .send({ value: 'nouveau-mdp-test', reason: '[test-dev-routes] rotation' })
    const res = await request(app)
      .get('/api/developer/config/SMTP_PASS/history')
      .set('Cookie', devCookie)
    expect(res.status).toBe(200)
    expect(res.body.data[0].newValue).toBe(MASK)
  })

  it('POST /config/:key/reveal exige le mot de passe, renvoie la valeur en clair et audite', async () => {
    // Mot de passe connu le temps du test (hachage d'origine restauré ensuite)
    const original = (await prisma.user.findUniqueOrThrow({ where: { id: devUser.id }, select: { passwordHash: true } })).passwordHash
    await prisma.user.update({ where: { id: devUser.id }, data: { passwordHash: await hashPassword('Revelation-Test-2026') } })
    try {
      const reveal = (body: Record<string, unknown>) => request(app)
        .post('/api/developer/config/SMTP_PASS/reveal')
        .set('Cookie', `${devCookie}; ${csrfCookie}`)
        .set('x-csrf-token', csrfToken)
        .send(body)
      expect((await reveal({})).status).toBe(400)
      expect((await reveal({ password: 'mauvais-mot-de-passe' })).status).toBe(403)
      const res = await reveal({ password: 'Revelation-Test-2026' })
      expect(res.status).toBe(200)
      expect(res.body.data.value).toBe('nouveau-mdp-test')
    } finally {
      await prisma.user.update({ where: { id: devUser.id }, data: { passwordHash: original } })
    }
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'SystemConfig', entityId: 'SMTP_PASS' },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit?.action).toBe('DEVELOPER_PANEL_CONFIG_CHANGED')
    // Jamais en clair en base, ni dans l'historique
    const row = await prisma.systemConfig.findUniqueOrThrow({ where: { key: 'SMTP_PASS' } })
    expect(row.value.startsWith('enc:v1:')).toBe(true)
    const history = await prisma.systemConfigHistory.findFirstOrThrow({ where: { configKey: 'SMTP_PASS' }, orderBy: { createdAt: 'desc' } })
    expect(history.newValue).not.toContain('nouveau-mdp-test')
  })
})
