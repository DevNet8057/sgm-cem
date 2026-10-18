// Reste à faire n° 4 : réglages absents de la base visibles et modifiables depuis
// le panneau (catalogue), et relecture du cache entre processus (API ↔ worker).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { getConfig, refreshConfigCacheIfChanged } from '../src/services/config.service'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const KEY = 'WHATSAPP_TEMPLATE_RELEVE'
let cookie = ''
let token = ''
let saved: { value: string } | null = null

beforeAll(async () => {
  const dev = await prisma.user.findFirst({ where: { role: 'DEVELOPER' } })
  if (!dev) throw new Error('Seed requis : compte DEVELOPER')
  saved = await prisma.systemConfig.findUnique({ where: { key: KEY }, select: { value: true } })
  await prisma.systemConfig.deleteMany({ where: { key: KEY } })
  const auth = await testCookie({ userId: dev.id, role: 'DEVELOPER', email: dev.email })
  const res = await request(app).get('/api/csrf-token').set('Cookie', auth)
  cookie = `${auth}; ${(res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]}`
  token = res.body.token
})

afterAll(async () => {
  await prisma.systemConfigHistory.deleteMany({ where: { configKey: KEY, reason: '[test-config]' } })
  await prisma.systemConfig.deleteMany({ where: { key: KEY } })
  if (saved) await prisma.systemConfig.create({ data: { key: KEY, value: saved.value, category: 'NOTIFICATIONS', label: KEY } })
})

const put = (key: string, value: string) =>
  request(app).put(`/api/developer/config/${key}`).set('Cookie', cookie).set('x-csrf-token', token).send({ value, reason: '[test-config]' })

describe('Réglages du catalogue', () => {
  it('une clé absente de la base est listée « non réglée »', async () => {
    const res = await request(app).get('/api/developer/config').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.data.find((c: { key: string }) => c.key === KEY)).toMatchObject({ isSet: false, value: '', category: 'NOTIFICATIONS', updatedAt: null })
  })

  it('la première saisie crée la ligne avec les informations du catalogue', async () => {
    const res = await put(KEY, 'sgm_releve_mensuel')
    expect(res.status).toBe(200)
    const row = await prisma.systemConfig.findUniqueOrThrow({ where: { key: KEY } })
    expect(row).toMatchObject({ value: 'sgm_releve_mensuel', category: 'NOTIFICATIONS', isSecret: false })
    expect(row.label).toMatch(/relevé mensuel/)
    expect(getConfig(KEY)).toBe('sgm_releve_mensuel')
  })

  it('une clé hors catalogue reste refusée', async () => {
    expect((await put('CLE_INVENTEE_PAR_TEST', 'x')).status).toBe(404)
  })
})

describe('Relecture du cache entre processus', () => {
  it('un changement écrit par un autre processus est relu', async () => {
    await refreshConfigCacheIfChanged()
    // Autre processus : écriture directe en base, sans passer par ce cache
    await prisma.systemConfig.update({ where: { key: KEY }, data: { value: 'sgm_releve_v2' } })
    expect(getConfig(KEY)).toBe('sgm_releve_mensuel')
    expect(await refreshConfigCacheIfChanged()).toBe(true)
    expect(getConfig(KEY)).toBe('sgm_releve_v2')
    expect(await refreshConfigCacheIfChanged()).toBe(false)
  })
})
