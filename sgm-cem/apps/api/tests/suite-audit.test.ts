// Point important n° 12 (EF-M13-01) : chaque écriture d'audit porte l'IP, le
// navigateur et l'auteur réel sous impersonation ; le journal est inaltérable.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `aud-${Date.now()}`
let devId = ''
let respId = ''
let membreId = ''

async function as(userId: string, role: string, email: string, impersonatedBy?: string) {
  const cookie = await testCookie({ userId, role, email, impersonatedBy })
  const res = await request(app).get('/api/csrf-token').set('Cookie', cookie)
  const csrf = (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]
  return { cookie: `${cookie}; ${csrf}`, token: res.body.token as string }
}

beforeAll(async () => {
  const mk = (tag: string, role: string) => prisma.user.create({
    data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'T', fullName: `${tag} T`, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: role as never, mustChangePassword: false },
  })
  devId = (await mk('dev', 'DEVELOPER')).id
  respId = (await mk('resp', 'RESPONSABLE')).id
  const mem = await mk('mem', 'MEMBRE')
  membreId = (await prisma.membre.create({ data: { userId: mem.id, memberId: `${RUN}-mm`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })).id
})

describe('Journal d\'audit', () => {
  it('écriture directe dans une route : IP et navigateur renseignés', async () => {
    const s = await as(respId, 'RESPONSABLE', `${RUN}-resp@test.local`)
    const res = await request(app).patch(`/api/membres/${membreId}/status`).set('Cookie', s.cookie).set('x-csrf-token', s.token)
      .set('User-Agent', 'NavigateurDeTest/1.0').send({ statut: 'EN_SUIVI' })
    expect(res.status).toBe(200)
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: membreId, entityType: 'Membre' }, orderBy: { createdAt: 'desc' } })
    expect(log).toMatchObject({ userId: respId, userAgent: 'NavigateurDeTest/1.0', impersonatedById: null })
    expect(log.ipAddress).toBeTruthy()
    expect(log.details).toMatchObject({ statut: 'EN_SUIVI', ancienStatut: 'EN_OBSERVATION' })
  })

  it('sous impersonation : l\'auteur réel est noté', async () => {
    const s = await as(respId, 'RESPONSABLE', `${RUN}-resp@test.local`, devId)
    expect((await request(app).patch(`/api/membres/${membreId}/status`).set('Cookie', s.cookie).set('x-csrf-token', s.token).send({ statut: 'FIN_DE_SUIVI' })).status).toBe(200)
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: membreId, entityType: 'Membre' }, orderBy: { createdAt: 'desc' } })
    expect(log).toMatchObject({ userId: respId, impersonatedById: devId })
  })

  it('inaltérable : ni modification, ni suppression ; seul l\'effacement de l\'IP est permis', async () => {
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: membreId, entityType: 'Membre' } })
    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { details: { falsifie: true } } })).rejects.toThrow(/JOURNAL_INALTERABLE/)
    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { ipAddress: '1.2.3.4' } })).rejects.toThrow(/JOURNAL_INALTERABLE/)
    await expect(prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(/JOURNAL_INALTERABLE/)
    await prisma.auditLog.update({ where: { id: log.id }, data: { ipAddress: null, userAgent: null } })
    expect(await prisma.auditLog.findUniqueOrThrow({ where: { id: log.id } })).toMatchObject({ ipAddress: null, action: log.action })
  })
})
