// Phase 4.7 — GED : lecture selon le rôle (EF-M11-03), type réel des fichiers,
// versions (EF-M11-05), conservation : avertissement puis archivage (EF-M11-04).
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { runGedRetention } from '../src/services/ged-retention.service'
import { SCHEDULED_JOBS } from '../src/jobs/scheduler'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `ged-${Date.now()}`
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')
type Person = { id: string; email: string; role: string }
let responsable: Person, auteur: Person, autreCollecteur: Person, chefCommission: Person
let commissionId = ''
let typeCode = ''
let docId = ''

async function person(tag: string, role: string): Promise<Person> {
  const u = await prisma.user.create({
    data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'T', fullName: `${tag} T`, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: role as never, mustChangePassword: false },
  })
  return { id: u.id, email: u.email, role }
}

async function session(p: Person) {
  const cookie = await testCookie({ userId: p.id, role: p.role, email: p.email })
  const res = await request(app).get('/api/csrf-token').set('Cookie', cookie)
  const csrf = (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]
  return { cookie: `${cookie}; ${csrf}`, token: res.body.token as string }
}

async function call(p: Person, method: 'get' | 'patch', path: string, body?: Record<string, unknown>) {
  const s = await session(p)
  const r = request(app)[method](path).set('Cookie', s.cookie).set('x-csrf-token', s.token)
  return body ? r.send(body) : r
}

async function upload(p: Person, path: string, content: Buffer, mime = 'application/pdf', name = 'pv.pdf') {
  const s = await session(p)
  const r = request(app).post(path).set('Cookie', s.cookie).set('x-csrf-token', s.token)
    .attach('file', content, { filename: name, contentType: mime })
  return path.endsWith('/documents') ? r.field('commissionId', commissionId).field('typeCode', typeCode).field('titre', `PV ${RUN}`) : r
}

const visible = async (p: Person) => ((await call(p, 'get', `/api/commissions/documents?commissionId=${commissionId}`)).body.data as Array<{ id: string }>).map(d => d.id)

beforeAll(async () => {
  responsable = await person('resp', 'RESPONSABLE')
  auteur = await person('aut', 'COLLECTEUR')
  autreCollecteur = await person('col', 'COLLECTEUR')
  chefCommission = await person('chef', 'COLLECTEUR')
  commissionId = (await prisma.commission.create({ data: { nom: `Commission ${RUN}`, responsableId: chefCommission.id } })).id
  typeCode = `T${String(Date.now()).slice(-6)}`
  await prisma.typeDocument.create({ data: { code: typeCode, libelle: 'Procès-verbal', retentionAnnees: 5 } })
})

describe('GED', () => {
  it('type réel vérifié : un faux PDF est refusé', async () => {
    const fake = await upload(auteur, '/api/commissions/documents', Buffer.from('<script>alert(1)</script>'))
    expect(fake.status).toBe(400)
    const ok = await upload(auteur, '/api/commissions/documents', PDF)
    expect(ok.status).toBe(201)
    docId = ok.body.data.id
  })

  it('brouillon visible de l\'auteur, du responsable de la commission et des niveaux 3 ; pas des autres collecteurs', async () => {
    expect(await visible(auteur)).toContain(docId)
    expect(await visible(chefCommission)).toContain(docId)
    expect(await visible(responsable)).toContain(docId)
    expect(await visible(autreCollecteur)).not.toContain(docId)
    expect((await call(autreCollecteur, 'get', `/api/commissions/documents/${docId}/download`)).status).toBe(404)
    expect((await call(autreCollecteur, 'patch', `/api/commissions/documents/${docId}/submit`)).status).toBe(403)
  })

  it('approuvé : visible de tous les niveaux 2', async () => {
    expect((await call(auteur, 'patch', `/api/commissions/documents/${docId}/submit`)).status).toBe(200)
    expect((await call(responsable, 'patch', `/api/commissions/documents/${docId}/approve`)).status).toBe(200)
    expect(await visible(autreCollecteur)).toContain(docId)
  })

  it('nouvelle version : suit le circuit puis remplace la version en vigueur', async () => {
    expect((await upload(autreCollecteur, `/api/commissions/documents/${docId}/versions`, PDF)).status).toBe(403)
    const v2 = await upload(auteur, `/api/commissions/documents/${docId}/versions`, PDF, 'application/pdf', 'pv-v2.pdf')
    expect(v2.status).toBe(201)
    expect(v2.body.data).toMatchObject({ version: 2, parentId: docId, statut: 'BROUILLON' })
    const v2Id = v2.body.data.id
    await call(auteur, 'patch', `/api/commissions/documents/${v2Id}/submit`)
    await call(responsable, 'patch', `/api/commissions/documents/${v2Id}/approve`)
    const family = await call(responsable, 'get', `/api/commissions/documents/${v2Id}/versions`)
    expect(family.body.data.map((d: { version: number; statut: string }) => `${d.version}:${d.statut}`)).toEqual(['2:APPROUVE', '1:ARCHIVE'])
  })

  it('conservation : avertissement unique avant l\'échéance, archivage à l\'échéance, aucune suppression', async () => {
    expect(SCHEDULED_JOBS.map(j => j.name)).toContain('ged-conservation')
    const soon = (await upload(auteur, '/api/commissions/documents', PDF)).body.data.id
    const expired = (await upload(auteur, '/api/commissions/documents', PDF)).body.data.id
    await prisma.document.update({ where: { id: soon }, data: { expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) } })
    await prisma.document.update({ where: { id: expired }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await runGedRetention()
    await runGedRetention()
    expect(await prisma.notification.count({ where: { userId: chefCommission.id, title: 'Document bientôt archivé' } })).toBe(1)
    expect((await prisma.document.findUniqueOrThrow({ where: { id: expired } })).statut).toBe('ARCHIVE')
    expect((await prisma.document.findUniqueOrThrow({ where: { id: soon } })).statut).toBe('BROUILLON')
  })
})
