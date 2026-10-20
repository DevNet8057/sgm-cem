// Point 17 : suivi d'erreurs (tâches, webhooks, envois) et santé du système.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { recordIncident, redactMessage, runTracked } from '../src/services/incident.service'
import { maxGapMs } from '../src/services/sante.service'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `sante-${Date.now()}`
let admin = { id: '', email: '', role: 'ADMIN' }
let tresorier = { id: '', email: '', role: 'TRESORIER' }

beforeAll(async () => {
  const mk = async (tag: string, role: string) => {
    const u = await prisma.user.create({ data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'S', fullName: `${tag} S`, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: role as never, mustChangePassword: false } })
    return { id: u.id, email: u.email, role }
  }
  admin = await mk('adm', 'ADMIN')
  tresorier = await mk('tre', 'TRESORIER')
})

const as = async (who: { id: string; email: string; role: string }) => testCookie({ userId: who.id, role: who.role, email: who.email })

describe('Suivi d’erreurs', () => {
  it('message expurgé : ni e-mail, ni téléphone, ni jeton', () => {
    const msg = redactMessage(new Error('Échec pour jean@exemple.cm au +237 6 99 88 77 66 avec Bearer abc.def-123'))
    expect(msg).not.toMatch(/jean@|699|abc\.def/)
    expect(msg).toContain('[e-mail]')
    expect(msg).toContain('[numéro]')
    expect(msg).toContain('Bearer [jeton]')
  })

  it('même erreur répétée : un seul incident, compteur incrémenté ; l’administration est prévenue une fois', async () => {
    const code = `${RUN}-yelii`
    await recordIncident('WEBHOOK', code, new Error('Signature invalide'))
    await recordIncident('WEBHOOK', code, new Error('Signature invalide'))
    const incidents = await prisma.incident.findMany({ where: { code } })
    expect(incidents).toHaveLength(1)
    expect(incidents[0].occurrences).toBe(2)
    const alerts = await prisma.notification.count({ where: { userId: admin.id, title: 'Incident technique', body: { contains: code } } })
    expect(alerts).toBe(1)
  })

  it('tâche suivie : succès puis échec enregistrés, échec transformé en incident', async () => {
    const nom = `${RUN}-tache`
    await runTracked(nom, async () => ({ traites: 3 }))
    let etat = await prisma.tacheEtat.findUnique({ where: { nom } })
    expect(etat?.dernierSucces).toBeTruthy()
    expect(etat?.resultat).toContain('traites')
    await expect(runTracked(nom, async () => { throw new Error('base indisponible') })).rejects.toThrow('base indisponible')
    etat = await prisma.tacheEtat.findUnique({ where: { nom } })
    expect(etat?.erreur).toBe('base indisponible')
    expect(await prisma.incident.count({ where: { source: 'TACHE', code: nom, resoluLe: null } })).toBe(1)
  })

  it('retard d’une tâche selon sa périodicité', () => {
    expect(maxGapMs({ every: 60_000 })).toBe(5 * 60_000)
    expect(maxGapMs({ pattern: '10 6 * * *', tz: 'Africa/Douala' })).toBe(26 * 3600_000)
    expect(maxGapMs({ pattern: '20 * * * *', tz: 'Africa/Douala' })).toBe(2 * 3600_000)
    expect(maxGapMs({ pattern: '0 8 1 * *', tz: 'Africa/Douala' })).toBe(32 * 24 * 3600_000)
  })
})

describe('Santé du système', () => {
  it('réservée à l’administration', async () => {
    expect((await request(app).get('/api/sante').set('Cookie', await as(tresorier))).status).toBe(403)
    const res = await request(app).get('/api/sante').set('Cookie', await as(admin))
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ database: 'ok' })
    expect(res.body.data.taches.length).toBeGreaterThan(5)
    expect(res.body.data.incidents.ouverts).toBeGreaterThanOrEqual(1)
  })

  it('incident marqué résolu (journalisé), une seule fois', async () => {
    const incident = await prisma.incident.findFirstOrThrow({ where: { code: `${RUN}-yelii` } })
    const cookie = await as(admin)
    const tokenRes = await request(app).get('/api/csrf-token').set('Cookie', cookie)
    const csrfCookie = (tokenRes.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]
    const cookies = `${cookie}; ${csrfCookie}`
    const res = await request(app).post(`/api/sante/incidents/${incident.id}/resoudre`).set('Cookie', cookies).set('x-csrf-token', tokenRes.body.token)
    expect(res.status).toBe(200)
    expect((await prisma.incident.findUnique({ where: { id: incident.id } }))?.resoluLe).toBeTruthy()
    expect(await prisma.auditLog.count({ where: { entityType: 'Incident', entityId: incident.id } })).toBe(1)
    const again = await request(app).post(`/api/sante/incidents/${incident.id}/resoudre`).set('Cookie', cookies).set('x-csrf-token', tokenRes.body.token)
    expect(again.status).toBe(404)
  })
})
