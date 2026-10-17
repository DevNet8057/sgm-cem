// Phase 4.3 — relances automatiques (déclarations en attente, fonds retenus,
// transferts non traités) et demande de remise du trésorier. Notifications
// in-app seulement : aucun envoi externe n'est déclenché par ces tâches.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { REMINDER_TITLES, runDailyReminders, runTransferReminders } from '../src/services/reminders.service'
import { SCHEDULED_JOBS } from '../src/jobs/scheduler'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `rel-${Date.now()}`
const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
type Person = { id: string; email: string; role: string }
let collecteur: Person, collecteurMomo: Person, detenteur: Person, recepteur: Person, tresorier: Person, sansFonds: Person
let membreId = ''
let rubriqueId = ''
let transferId = ''
let savedSettings: Record<string, number> = {}

async function person(tag: string, role: string): Promise<Person> {
  const u = await prisma.user.create({
    data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'T', fullName: `${tag} T`, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: role as never, mustChangePassword: false },
  })
  return { id: u.id, email: u.email, role }
}

async function call(p: Person, method: 'post' | 'patch', path: string, body: Record<string, unknown>) {
  const cookie = await testCookie({ userId: p.id, role: p.role, email: p.email })
  const res = await request(app).get('/api/csrf-token').set('Cookie', cookie)
  const csrf = (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]
  return request(app)[method](path).set('Cookie', `${cookie}; ${csrf}`).set('x-csrf-token', res.body.token as string).send(body)
}

function contribution(data: Record<string, unknown>) {
  return prisma.contribution.create({ data: { membreId, rubriqueId, montant: 1000, modePaiement: 'ESPECES', ...data } as never })
}

const notes = (userId: string, title: string) => prisma.notification.findMany({ where: { userId, title }, orderBy: { createdAt: 'asc' } })

beforeAll(async () => {
  const s = await prisma.systemSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } })
  savedSettings = { reminderDelayDays: s.reminderDelayDays, maxFundsRetentionDays: s.maxFundsRetentionDays, transferPendingReminderHours: s.transferPendingReminderHours, transferAlertTresorierHours: s.transferAlertTresorierHours }
  await prisma.systemSettings.update({ where: { id: 'singleton' }, data: { reminderDelayDays: 3, maxFundsRetentionDays: 5, transferPendingReminderHours: 24, transferAlertTresorierHours: 48 } })
  // Base de test partagée : le récapitulatif trésorerie d'une exécution précédente ne doit pas masquer celui-ci
  await prisma.notification.deleteMany({ where: { title: REMINDER_TITLES.alerteTresorier } })

  collecteur = await person('col', 'COLLECTEUR')
  collecteurMomo = await person('colm', 'COLLECTEUR')
  detenteur = await person('det', 'COLLECTEUR')
  recepteur = await person('rec', 'RESPONSABLE')
  tresorier = await person('tres', 'TRESORIER')
  sansFonds = await person('vide', 'COLLECTEUR')
  const m = await person('mem', 'MEMBRE')
  membreId = (await prisma.membre.create({ data: { userId: m.id, memberId: `${RUN}-mm`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })).id
  rubriqueId = (await prisma.rubrique.create({
    data: { code: `${RUN}-R`, title: 'Rubrique relances', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), status: 'OUVERTE', createdById: tresorier.id, createdByName: 'T' },
  })).id

  const now = Date.now()
  // Déclarations en espèces : 4 jours (relance) et 7 jours (> 2 × 3 : alerte trésorerie)
  await contribution({ collecteurId: collecteur.id, createdAt: new Date(now - 4 * DAY) })
  await contribution({ collecteurId: collecteur.id, montant: 2500, createdAt: new Date(now - 7 * DAY) })
  // Récente : pas encore en retard
  await contribution({ collecteurId: collecteur.id, createdAt: new Date(now - 1 * DAY) })
  // Paiement électronique en attente du prestataire : jamais imputé au collecteur
  await contribution({ collecteurId: collecteurMomo.id, modePaiement: 'MTN_MOMO', externalTransactionId: `${RUN}-tx`, createdAt: new Date(now - 10 * DAY) })
  // Fonds confirmés détenus depuis 6 jours (> 5)
  await contribution({ collecteurId: detenteur.id, detenteurId: detenteur.id, statut: 'CONFIRME', localisationFonds: 'CHEZ_COLLECTEUR', montant: 4000, createdAt: new Date(now - 6 * DAY) })
  // Transfert en attente depuis 30 heures
  transferId = (await prisma.fundsTransfer.create({
    data: { senderId: detenteur.id, senderName: 'det T', receiverId: recepteur.id, receiverName: 'rec T', totalAmount: 1500, createdAt: new Date(now - 30 * HOUR) },
  })).id
})

afterAll(async () => {
  await prisma.systemSettings.update({ where: { id: 'singleton' }, data: savedSettings })
})

describe('Relances automatiques', () => {
  it('catalogue : relances quotidiennes et horaires planifiées', () => {
    expect(SCHEDULED_JOBS.map(j => j.name)).toEqual(expect.arrayContaining(['relances-quotidiennes', 'relances-transferts']))
  })

  it('déclarations en retard → collecteur ; fonds retenus → détenteur ; double délai → trésorerie', async () => {
    const r = await runDailyReminders()
    expect(r.alerteTresorerie).toBe(true)

    const col = await notes(collecteur.id, REMINDER_TITLES.declarations)
    expect(col).toHaveLength(1)
    expect(col[0].body).toContain('2 paiement(s)')
    expect(col[0].body).toMatch(/3\s500/)
    expect(col[0].targetView).toBe('validations')

    expect(await notes(collecteurMomo.id, REMINDER_TITLES.declarations)).toHaveLength(0)

    const det = await notes(detenteur.id, REMINDER_TITLES.fonds)
    expect(det).toHaveLength(1)
    expect(det[0].body).toMatch(/4\s000/)

    const alerte = await notes(tresorier.id, REMINDER_TITLES.alerteTresorier)
    expect(alerte).toHaveLength(1)
    expect(alerte[0].body).toMatch(/paiement\(s\) non confirmé\(s\) depuis plus de 6 jours/)
  })

  it('au plus une relance par personne et par jour', async () => {
    const r = await runDailyReminders()
    expect(r.alerteTresorerie).toBe(false)
    expect(await notes(collecteur.id, REMINDER_TITLES.declarations)).toHaveLength(1)
    expect(await notes(detenteur.id, REMINDER_TITLES.fonds)).toHaveLength(1)
    expect(await notes(tresorier.id, REMINDER_TITLES.alerteTresorier)).toHaveLength(1)
  })

  it('transfert : rappel au destinataire, renouvelé par intervalle, alerte trésorerie unique', async () => {
    const t0 = Date.now()
    await runTransferReminders(new Date(t0))
    await runTransferReminders(new Date(t0))
    let tr = await prisma.fundsTransfer.findUniqueOrThrow({ where: { id: transferId } })
    expect(tr.remindersSentCount).toBe(1)
    expect(tr.tresorierAlertedAt).toBeNull()
    expect(await notes(recepteur.id, REMINDER_TITLES.transfert)).toHaveLength(1)

    // 25 heures plus tard : 55 h d'attente → second rappel et alerte trésorerie
    await runTransferReminders(new Date(t0 + 25 * HOUR))
    await runTransferReminders(new Date(t0 + 26 * HOUR))
    tr = await prisma.fundsTransfer.findUniqueOrThrow({ where: { id: transferId } })
    expect(tr.remindersSentCount).toBe(2)
    expect(tr.tresorierAlertedAt).not.toBeNull()
    expect(await notes(recepteur.id, REMINDER_TITLES.transfert)).toHaveLength(2)
    const alertes = (await notes(tresorier.id, REMINDER_TITLES.alerteTransfert)).filter(n => (n.data as { transferId?: string } | null)?.transferId === transferId)
    expect(alertes).toHaveLength(1)
  })

  it('un transfert traité n\'est plus relancé', async () => {
    await prisma.fundsTransfer.update({ where: { id: transferId }, data: { status: 'CONFIRMED', confirmedAt: new Date() } })
    await runTransferReminders(new Date(Date.now() + 80 * HOUR))
    expect((await prisma.fundsTransfer.findUniqueOrThrow({ where: { id: transferId } })).remindersSentCount).toBe(2)
  })

  it('délais à 0 : relances désactivées', async () => {
    await prisma.systemSettings.update({ where: { id: 'singleton' }, data: { transferPendingReminderHours: 0, transferAlertTresorierHours: 0 } })
    expect(await runTransferReminders()).toEqual({ rappels: 0, alertes: 0 })
    await prisma.systemSettings.update({ where: { id: 'singleton' }, data: { transferPendingReminderHours: 24, transferAlertTresorierHours: 48 } })
  })

  it('paramètres : délais des transferts modifiables par la trésorerie', async () => {
    const res = await call(tresorier, 'patch', '/api/settings', { transferPendingReminderHours: 12, transferAlertTresorierHours: 36 })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ transferPendingReminderHours: 12, transferAlertTresorierHours: 36 })
    const bad = await call(tresorier, 'patch', '/api/settings', { transferPendingReminderHours: -1 })
    expect(bad.status).toBe(400)
  })
})

describe('Demande de remise', () => {
  it('le trésorier demande au détenteur : notification ciblée, audit, aucun effet comptable', async () => {
    const before = await prisma.fundMovement.count()
    const res = await call(tresorier, 'post', '/api/funds/remise-requests', { detenteurId: detenteur.id, message: 'Avant dimanche, merci.' })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ montant: 4000, count: 1 })

    const n = await notes(detenteur.id, REMINDER_TITLES.remise)
    expect(n).toHaveLength(1)
    expect(n[0].body).toMatch(/4\s000/)
    expect(n[0].body).toContain('Avant dimanche, merci.')
    expect(await prisma.auditLog.count({ where: { entityType: 'DemandeRemise', entityId: detenteur.id, userId: tresorier.id } })).toBe(1)
    expect(await prisma.fundMovement.count()).toBe(before)
  })

  it('pas deux demandes en moins d\'une heure', async () => {
    const res = await call(tresorier, 'post', '/api/funds/remise-requests', { detenteurId: detenteur.id })
    expect(res.status).toBe(409)
  })

  it('refusée sans fonds détenus, et réservée à la trésorerie', async () => {
    expect((await call(tresorier, 'post', '/api/funds/remise-requests', { detenteurId: sansFonds.id })).status).toBe(400)
    expect((await call(collecteur, 'post', '/api/funds/remise-requests', { detenteurId: detenteur.id })).status).toBe(403)
  })
})
