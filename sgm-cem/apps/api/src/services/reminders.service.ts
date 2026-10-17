// Relances automatiques (lot 4.3 — EF-M06-07, EF-M07-08) et demande de remise
// (EF-M07-04). Notifications in-app (doublées d'un push navigateur) uniquement :
// aucune relance n'envoie de WhatsApp, SMS ou e-mail. Aucun effet comptable.
// Planification : jobs/scheduler.ts (relances quotidiennes, transferts toutes les heures).
import type { PrismaClient } from '@prisma/client'
import { getPrisma } from '../lib/prisma'
import { formatAmount } from '../lib/utils'
import { logger } from '../lib/logger'
import { alertTresoriers, notifyInApp } from './notification'
import { TRANSFERABLE_LOCATIONS } from './fund-ledger.service'

const prisma = getPrisma()
const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

// Titres fixes : ils servent aussi à ne pas relancer deux fois la même personne
// le même jour (tâche relancée, deux processus, rattrapage)
export const REMINDER_TITLES = {
  declarations: 'Paiements à confirmer en retard',
  fonds: 'Fonds à remettre',
  transfert: 'Transfert toujours en attente',
  alerteTresorier: 'Retards de la collecte',
  alerteTransfert: 'Transfert non traité',
  remise: 'Demande de remise des fonds',
} as const

const RELANCE = 'RELANCE'

async function settingsOf(client: PrismaClient) {
  return client.systemSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } })
}

/** Une notification de ce titre a-t-elle déjà été adressée à cette personne depuis `since` ? */
export async function notifiedSince(userId: string, title: string, since: Date, client: PrismaClient = prisma): Promise<boolean> {
  return (await client.notification.count({ where: { userId, title, createdAt: { gte: since } } })) > 0
}

// Déclarations manuelles (espèces, virement) que seul le collecteur désigné confirme ;
// les paiements électroniques attendent le prestataire, pas le collecteur
const manualPending = {
  statut: 'EN_ATTENTE_CONFIRMATION' as const,
  modePaiement: { in: ['ESPECES' as const, 'VIREMENT' as const] },
  externalTransactionId: null,
  momoTransactionId: null,
  collecteurId: { not: null },
}

type Bucket = { count: number; total: number }
function add(map: Map<string, Bucket>, key: string, montant: number): void {
  const row = map.get(key) ?? { count: 0, total: 0 }
  row.count++
  row.total += montant
  map.set(key, row)
}

/**
 * Relance quotidienne :
 *  • déclarations en attente depuis plus de `reminderDelayDays` jours → leur collecteur ;
 *  • fonds confirmés détenus depuis plus de `maxFundsRetentionDays` jours → leur détenteur ;
 *  • au-delà du double de ces délais → un récapitulatif à la trésorerie.
 * Un délai à 0 désactive la relance correspondante. Au plus une relance par
 * personne et par jour.
 */
export async function runDailyReminders(now = new Date(), client: PrismaClient = prisma): Promise<{
  collecteursRelances: number; detenteursRelances: number; alerteTresorerie: boolean
}> {
  const settings = await settingsOf(client)
  const dayAgo = new Date(now.getTime() - 20 * HOUR)   // marge : l'heure d'exécution peut glisser
  const late = new Map<string, Bucket>()
  const veryLate: Bucket = { count: 0, total: 0 }
  const held = new Map<string, Bucket>()
  const heldVeryLate: Bucket = { count: 0, total: 0 }

  if (settings.reminderDelayDays > 0) {
    const limit = new Date(now.getTime() - settings.reminderDelayDays * DAY)
    const alertLimit = new Date(now.getTime() - 2 * settings.reminderDelayDays * DAY)
    const rows = await client.contribution.findMany({
      where: { ...manualPending, createdAt: { lt: limit } },
      select: { collecteurId: true, montant: true, createdAt: true },
    })
    for (const r of rows) {
      add(late, r.collecteurId!, r.montant)
      if (r.createdAt < alertLimit) { veryLate.count++; veryLate.total += r.montant }
    }
  }

  if (settings.maxFundsRetentionDays > 0) {
    const limit = new Date(now.getTime() - settings.maxFundsRetentionDays * DAY)
    const alertLimit = new Date(now.getTime() - 2 * settings.maxFundsRetentionDays * DAY)
    const rows = await client.contribution.findMany({
      where: { statut: 'CONFIRME', localisationFonds: { in: [...TRANSFERABLE_LOCATIONS] }, detenteurId: { not: null }, createdAt: { lt: limit } },
      select: { detenteurId: true, montant: true, createdAt: true },
    })
    for (const r of rows) {
      add(held, r.detenteurId!, r.montant)
      if (r.createdAt < alertLimit) { heldVeryLate.count++; heldVeryLate.total += r.montant }
    }
  }

  let collecteursRelances = 0
  for (const [userId, b] of late) {
    if (await notifiedSince(userId, REMINDER_TITLES.declarations, dayAgo, client)) continue
    await notifyInApp(userId, REMINDER_TITLES.declarations,
      `${b.count} paiement(s) déclaré(s) attendent votre confirmation depuis plus de ${settings.reminderDelayDays} jour(s) (${formatAmount(b.total)}). Confirmez-les ou refusez-les.`,
      RELANCE, { kind: 'relance-declarations', count: b.count }, { view: 'validations' })
    collecteursRelances++
  }

  let detenteursRelances = 0
  for (const [userId, b] of held) {
    if (await notifiedSince(userId, REMINDER_TITLES.fonds, dayAgo, client)) continue
    await notifyInApp(userId, REMINDER_TITLES.fonds,
      `Vous détenez ${formatAmount(b.total)} (${b.count} contribution(s)) depuis plus de ${settings.maxFundsRetentionDays} jour(s). Remettez-les par le circuit officiel.`,
      RELANCE, { kind: 'relance-fonds', count: b.count }, { view: 'collecteurs' })
    detenteursRelances++
  }

  let alerteTresorerie = false
  if (veryLate.count > 0 || heldVeryLate.count > 0) {
    const parts: string[] = []
    if (veryLate.count > 0) parts.push(`${veryLate.count} paiement(s) non confirmé(s) depuis plus de ${2 * settings.reminderDelayDays} jours (${formatAmount(veryLate.total)})`)
    if (heldVeryLate.count > 0) parts.push(`${formatAmount(heldVeryLate.total)} détenus depuis plus de ${2 * settings.maxFundsRetentionDays} jours (${heldVeryLate.count} contribution(s))`)
    // Un seul récapitulatif par jour : le contrôle porte sur un trésorier quelconque
    const anyTreasurer = await client.notification.findFirst({
      where: { title: REMINDER_TITLES.alerteTresorier, createdAt: { gte: dayAgo } }, select: { id: true },
    })
    if (!anyTreasurer) {
      await alertTresoriers(REMINDER_TITLES.alerteTresorier, `${parts.join(' ; ')}. Les personnes concernées ont été relancées.`,
        { kind: 'alerte-retards', declarations: veryLate.count, fonds: heldVeryLate.count }, { view: 'collecteurs' })
      alerteTresorerie = true
    }
  }

  logger.info({ collecteursRelances, detenteursRelances, alerteTresorerie }, 'Relances quotidiennes terminées')
  return { collecteursRelances, detenteursRelances, alerteTresorerie }
}

/**
 * Transferts en attente de réception (toutes les heures) :
 *  • non traités depuis `transferPendingReminderHours` → rappel au destinataire,
 *    renouvelé à chaque nouvel intervalle (compteur remindersSentCount) ;
 *  • non traités depuis `transferAlertTresorierHours` → une alerte à la trésorerie.
 * Chaque envoi est réservé par une mise à jour conditionnelle : deux exécutions
 * simultanées ne relancent jamais deux fois.
 */
export async function runTransferReminders(now = new Date(), client: PrismaClient = prisma): Promise<{ rappels: number; alertes: number }> {
  const settings = await settingsOf(client)
  const reminderMs = settings.transferPendingReminderHours * HOUR
  const alertMs = settings.transferAlertTresorierHours * HOUR
  if (reminderMs <= 0 && alertMs <= 0) return { rappels: 0, alertes: 0 }

  const oldest = Math.min(...[reminderMs, alertMs].filter(ms => ms > 0))
  const pending = await client.fundsTransfer.findMany({
    where: { status: 'PENDING_APPROVAL', createdAt: { lt: new Date(now.getTime() - oldest) } },
    select: { id: true, createdAt: true, receiverId: true, receiverName: true, senderName: true, totalAmount: true, lastReminderSentAt: true, tresorierAlertedAt: true },
    orderBy: { createdAt: 'asc' },
  })

  let rappels = 0
  let alertes = 0
  for (const t of pending) {
    const age = now.getTime() - t.createdAt.getTime()
    const hours = Math.floor(age / HOUR)

    if (reminderMs > 0 && age >= reminderMs && (!t.lastReminderSentAt || now.getTime() - t.lastReminderSentAt.getTime() >= reminderMs)) {
      const claimed = await client.fundsTransfer.updateMany({
        where: { id: t.id, status: 'PENDING_APPROVAL', lastReminderSentAt: t.lastReminderSentAt },
        data: { lastReminderSentAt: now, remindersSentCount: { increment: 1 } },
      })
      if (claimed.count === 1) {
        await notifyInApp(t.receiverId, REMINDER_TITLES.transfert,
          `${t.senderName} vous a transféré ${formatAmount(t.totalAmount)} il y a ${hours} heure(s). Confirmez la réception ou refusez le transfert.`,
          'TRANSFER', { kind: 'relance-transfert', transferId: t.id }, { view: 'transfer-validations', id: t.id })
        rappels++
      }
    }

    if (alertMs > 0 && age >= alertMs && !t.tresorierAlertedAt) {
      const claimed = await client.fundsTransfer.updateMany({
        where: { id: t.id, status: 'PENDING_APPROVAL', tresorierAlertedAt: null },
        data: { tresorierAlertedAt: now },
      })
      if (claimed.count === 1) {
        await alertTresoriers(REMINDER_TITLES.alerteTransfert,
          `Le transfert de ${formatAmount(t.totalAmount)} de ${t.senderName} à ${t.receiverName} attend depuis ${hours} heure(s).`,
          { kind: 'alerte-transfert', transferId: t.id }, { view: 'collecteurs' })
        alertes++
      }
    }
  }

  if (rappels || alertes) logger.info({ rappels, alertes }, 'Relances des transferts envoyées')
  return { rappels, alertes }
}

/** Fonds remettables détenus par une personne (base de la demande de remise). */
export async function heldFunds(detenteurId: string, client: PrismaClient = prisma): Promise<Bucket> {
  const agg = await client.contribution.aggregate({
    where: { statut: 'CONFIRME', detenteurId, localisationFonds: { in: [...TRANSFERABLE_LOCATIONS] } },
    _sum: { montant: true },
    _count: true,
  })
  return { count: agg._count, total: agg._sum.montant ?? 0 }
}
