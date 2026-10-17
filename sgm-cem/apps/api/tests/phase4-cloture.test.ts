// Phase 4.2 — clôture mensuelle (décision du Bureau) : le trésorier présente,
// un administrateur vise ; un mois visé fige les montants (déclencheur en
// base), les statuts restent modifiables.
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { monthBounds } from '../src/services/closure.service'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `clo-${Date.now()}`
const ANNEE = 2020
const MOIS = 1
const hasChromium = Boolean(process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH))
type Person = { id: string; email: string; role: string }
let tresorier: Person, admin: Person, collecteur: Person
let oldContributionId = ''
let currentContributionId = ''
let closureId = ''

async function person(tag: string, role: string): Promise<Person> {
  const u = await prisma.user.create({
    data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'T', fullName: `${tag} T`, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: role as never, mustChangePassword: false },
  })
  return { id: u.id, email: u.email, role }
}

async function call(p: Person, method: 'get' | 'post' | 'patch', path: string, body?: Record<string, unknown>) {
  const cookie = await testCookie({ userId: p.id, role: p.role, email: p.email })
  const res = await request(app).get('/api/csrf-token').set('Cookie', cookie)
  const csrf = (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]
  const r = request(app)[method](path).set('Cookie', `${cookie}; ${csrf}`).set('x-csrf-token', res.body.token as string)
  return body ? r.send(body) : r
}

const present = (extra: Record<string, unknown> = {}) => call(tresorier, 'post', '/api/closures', { annee: ANNEE, mois: MOIS, caisseComptee: 0, soldeBancaire: 0, soldePortefeuille: 0, ...extra })

beforeAll(async () => {
  // Base de test partagée : la clôture de janvier 2020 d'une exécution précédente est retirée
  await prisma.clotureMensuelle.deleteMany({ where: { annee: ANNEE, mois: MOIS } })
  tresorier = await person('tres', 'TRESORIER')
  admin = await person('adm', 'ADMIN')
  collecteur = await person('col', 'COLLECTEUR')
  const m = await person('mem', 'MEMBRE')
  const membreId = (await prisma.membre.create({ data: { userId: m.id, memberId: `${RUN}-mm`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })).id
  const rubriqueId = (await prisma.rubrique.create({
    data: { code: `${RUN}-R`, title: 'Rubrique clôture', type: 'PONCTUELLE', fiscalYear: ANNEE, openDate: new Date('2020-01-01'), status: 'OUVERTE', createdById: tresorier.id, createdByName: 'T' },
  })).id
  // 31 janvier 2020 à 23 h 30, heure de Yaoundé : encore dans le mois
  oldContributionId = (await prisma.contribution.create({
    data: { membreId, rubriqueId, montant: 5000, modePaiement: 'ESPECES', statut: 'CONFIRME', createdAt: new Date('2020-01-31T22:30:00Z') },
  })).id
  currentContributionId = (await prisma.contribution.create({ data: { membreId, rubriqueId, montant: 2000, modePaiement: 'ESPECES', statut: 'CONFIRME' } })).id
})

describe('Clôture mensuelle', () => {
  it('bornes du mois à l\'heure de Yaoundé', () => {
    const { start, end } = monthBounds(2020, 1)
    expect(start.toISOString()).toBe('2019-12-31T23:00:00.000Z')
    expect(end.toISOString()).toBe('2020-01-31T22:59:59.999Z')
  })

  it('aperçu : encaissé du mois et attendus du grand livre ; réservé à la trésorerie', async () => {
    const res = await call(tresorier, 'get', `/api/closures/preview?annee=${ANNEE}&mois=${MOIS}`)
    expect(res.status).toBe(200)
    expect(res.body.data.totalEncaisse).toBeGreaterThanOrEqual(5000)
    expect(res.body.data.libelle).toBe('janvier 2020')
    expect((await call(collecteur, 'get', '/api/closures')).status).toBe(403)
  })

  it('présentation : mois terminé seulement, écart à justifier', async () => {
    const now = new Date()
    expect((await call(tresorier, 'post', '/api/closures', { annee: now.getFullYear(), mois: now.getMonth() + 1, caisseComptee: 0, soldeBancaire: 0, soldePortefeuille: 0 })).status).toBe(400)
    const preview = (await call(tresorier, 'get', `/api/closures/preview?annee=${ANNEE}&mois=${MOIS}`)).body.data
    const unjustified = await present({ caisseComptee: preview.attenduCaisse + 1000, soldeBancaire: preview.attenduBanque, soldePortefeuille: preview.attenduPortefeuille })
    expect(unjustified.status).toBe(400)
    const res = await present({ caisseComptee: preview.attenduCaisse + 1000, soldeBancaire: preview.attenduBanque, soldePortefeuille: preview.attenduPortefeuille, justification: 'Don anonyme non enregistré, à régulariser en février' })
    expect(res.status).toBe(201)
    closureId = res.body.data.id
    expect(res.body.data).toMatchObject({ statut: 'PRESENTEE', caisseComptee: preview.attenduCaisse + 1000 })
    expect(await prisma.notification.count({ where: { userId: admin.id, title: 'Clôture à viser' } })).toBe(1)
    expect((await present()).status).toBe(409)
  })

  it('refus motivé puis nouvelle présentation', async () => {
    expect((await call(tresorier, 'patch', `/api/closures/${closureId}/validate`)).status).toBe(403)
    const rej = await call(admin, 'patch', `/api/closures/${closureId}/reject`, { reason: 'Relevé bancaire du 31 à joindre' })
    expect(rej.body.data.statut).toBe('REJETEE')
    const preview = (await call(tresorier, 'get', `/api/closures/preview?annee=${ANNEE}&mois=${MOIS}`)).body.data
    const again = await present({ caisseComptee: preview.attenduCaisse, soldeBancaire: preview.attenduBanque, soldePortefeuille: preview.attenduPortefeuille })
    expect(again.status).toBe(201)
    expect(again.body.data).toMatchObject({ id: closureId, statut: 'PRESENTEE', rejectionReason: null })
  })

  it('visa : le mois est clos, montants figés, statuts modifiables', async () => {
    const res = await call(admin, 'patch', `/api/closures/${closureId}/validate`)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ statut: 'VALIDEE', validatedById: admin.id })
    expect(await prisma.auditLog.count({ where: { entityType: 'ClotureMensuelle', entityId: closureId } })).toBe(4)

    await expect(prisma.contribution.update({ where: { id: oldContributionId }, data: { montant: 4000 } })).rejects.toThrow(/MOIS_CLOS/)
    await expect(prisma.contribution.delete({ where: { id: oldContributionId } })).rejects.toThrow(/MOIS_CLOS/)
    await expect(prisma.contribution.update({ where: { id: oldContributionId }, data: { createdAt: new Date() } })).rejects.toThrow(/MOIS_CLOS/)
    const disputed = await prisma.contribution.update({ where: { id: oldContributionId }, data: { statut: 'LITIGE', litigeMotif: 'Contrôle après clôture' } })
    expect(disputed.statut).toBe('LITIGE')
    expect((await prisma.contribution.update({ where: { id: currentContributionId }, data: { montant: 2500 } })).montant).toBe(2500)
  })

  it.runIf(hasChromium)('PDF de clôture', async () => {
    const cookie = await testCookie({ userId: admin.id, role: admin.role, email: admin.email })
    const res = await request(app).get(`/api/closures/${closureId}/pdf`).set('Cookie', cookie).buffer(true)
      .parse((r, cb) => { const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))) })
    expect(res.status).toBe(200)
    expect((res.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 60_000)
})
