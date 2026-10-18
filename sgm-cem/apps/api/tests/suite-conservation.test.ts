// Reste à faire n° 7 : durées de conservation de la page /confidentialite appliquées
// chaque nuit ; identité d'un brouillon de don enregistrée seulement après l'accord.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { runDataRetention } from '../src/services/data-retention.service'
import { SCHEDULED_JOBS } from '../src/jobs/scheduler'

const prisma = getPrisma()
const RUN = `cons-${Date.now()}`
const OLD = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
const VERY_OLD = new Date(Date.now() - 4 * 365 * 24 * 60 * 60 * 1000)
let userId = ''
let rubriqueId = ''
let slug = ''

beforeAll(async () => {
  userId = (await prisma.user.create({
    data: { memberId: `${RUN}-u`, firstName: 'C', lastName: 'T', fullName: 'C T', email: `${RUN}@test.local`, passwordHash: 'disabled', role: 'TRESORIER', mustChangePassword: false },
  })).id
  rubriqueId = (await prisma.rubrique.create({
    data: { code: `${RUN}-R`, title: 'Rubrique conservation', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), status: 'OUVERTE', createdById: userId, createdByName: 'C T' },
  })).id
  slug = `${RUN}-collecte`
  await prisma.collectePublique.create({ data: { rubriqueId, publicSlug: slug, titre: 'Collecte conservation', description: 'Test', champsPersonnalises: [], montantMin: 500, montantsSuggeres: [500], isActive: true, createdById: userId, createdByName: 'C T' } })
})

describe('Durées de conservation', () => {
  it('tâche planifiée chaque nuit', () => {
    expect(SCHEDULED_JOBS.map(j => j.name)).toContain('donnees-conservation')
  })

  it('notifications de plus d\'un an supprimées, IP du journal effacées, action conservée', async () => {
    const oldNotif = await prisma.notification.create({ data: { userId, title: 'Ancienne', body: 'x', type: 'INFO', createdAt: OLD } })
    const newNotif = await prisma.notification.create({ data: { userId, title: 'Récente', body: 'x', type: 'INFO' } })
    const oldAudit = await prisma.auditLog.create({ data: { userId, userName: 'C T', action: 'LOGIN', entityType: 'Session', ipAddress: '10.0.0.1', userAgent: 'Test', createdAt: OLD } })
    const newAudit = await prisma.auditLog.create({ data: { userId, userName: 'C T', action: 'LOGIN', entityType: 'Session', ipAddress: '10.0.0.2', userAgent: 'Test' } })
    await runDataRetention()
    expect(await prisma.notification.findUnique({ where: { id: oldNotif.id } })).toBeNull()
    expect(await prisma.notification.findUnique({ where: { id: newNotif.id } })).not.toBeNull()
    expect(await prisma.auditLog.findUniqueOrThrow({ where: { id: oldAudit.id } })).toMatchObject({ ipAddress: null, userAgent: null, action: 'LOGIN' })
    expect(await prisma.auditLog.findUniqueOrThrow({ where: { id: newAudit.id } })).toMatchObject({ ipAddress: '10.0.0.2' })
  })

  it('codes et sessions expirés supprimés', async () => {
    const otp = await prisma.otpCode.create({ data: { phone: `+237${RUN}`, code: 'x', expiresAt: OLD } })
    const session = await prisma.userSession.create({ data: { userId, refreshToken: `${RUN}-rt`, expiresAt: OLD } })
    await runDataRetention()
    expect(await prisma.otpCode.findUnique({ where: { id: otp.id } })).toBeNull()
    expect(await prisma.userSession.findUnique({ where: { id: session.id } })).toBeNull()
  })

  it('donateur non-membre sans don depuis 3 ans : identité anonymisée, don conservé', async () => {
    const donor = await prisma.contributeurExterne.create({ data: { nom: 'Paul Donateur', phone: `+2376${String(Date.now()).slice(-8)}`, email: 'paul@exemple.test', createdAt: VERY_OLD } })
    const don = await prisma.contribution.create({
      data: { contributeurExterneId: donor.id, rubriqueId, montant: 2000, modePaiement: 'MTN_MOMO', statut: 'CONFIRME', mobileMoneyPhone: donor.phone, createdAt: VERY_OLD },
    })
    await runDataRetention()
    expect(await prisma.contributeurExterne.findUniqueOrThrow({ where: { id: donor.id } })).toMatchObject({ nom: 'Donateur anonymisé', email: null })
    expect(await prisma.contribution.findUniqueOrThrow({ where: { id: don.id } })).toMatchObject({ montant: 2000, statut: 'CONFIRME', mobileMoneyPhone: null })
  })
})

describe('Brouillon de don', () => {
  it('sans accord : ni nom, ni téléphone, ni e-mail enregistrés', async () => {
    const csrf = await request(app).get('/api/csrf-token')
    const cookie = (csrf.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]
    const send = (body: Record<string, unknown>) => request(app).post(`/api/public/collectes/${slug}/drafts`).set('Cookie', cookie).set('x-csrf-token', csrf.body.token).send(body)
    const without = await send({ nom: 'Awa', phone: '677112233', montant: 1000 })
    expect(without.status).toBe(201)
    const draft = await prisma.collecteDraft.findFirstOrThrow({ where: { collecte: { publicSlug: slug }, montant: 1000 } })
    expect(draft).toMatchObject({ nom: null, phone: null, email: null, montant: 1000 })
    await send({ nom: 'Awa', phone: '677112233', montant: 1500, consentement: true })
    expect(await prisma.collecteDraft.findFirstOrThrow({ where: { collecte: { publicSlug: slug }, montant: 1500 } })).toMatchObject({ nom: 'Awa', phone: '+237677112233' })
  })
})
