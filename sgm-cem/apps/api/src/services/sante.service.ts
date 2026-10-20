// Santé du système (EF-M10-01, accueil administrateur) et paiements bloqués
// (accueil trésorier). Tout est calculé côté serveur.
import type { Prisma } from '@prisma/client'
import { getPrisma } from '../lib/prisma'
import { sharedRedis } from '../middleware/rate-limit'
import { SCHEDULED_JOBS, type Repeat } from '../jobs/scheduler'
import { storageMode } from './storage'

const prisma = getPrisma()
const BLOCKED_AFTER_MS = 30 * 60_000

/**
 * Paiement électronique bloqué : en attente depuis plus de 30 minutes, sans
 * réponse définitive du prestataire (la réconciliation continue de le suivre).
 */
export function blockedPaymentsWhere(now = new Date()): Prisma.ContributionWhereInput {
  return {
    statut: 'EN_ATTENTE_CONFIRMATION',
    paymentStatus: { in: ['PENDING', 'PROCESSING'] },
    modePaiement: { in: ['MTN_MOMO', 'ORANGE_MONEY', 'YELII', 'CARTE_VISA'] },
    createdAt: { lt: new Date(now.getTime() - BLOCKED_AFTER_MS) },
  }
}

/** Délai au-delà duquel une tâche est « en retard » (5 périodes, ou une échéance manquée). */
export function maxGapMs(repeat: Repeat): number {
  if ('every' in repeat) return Math.max(repeat.every * 5, 5 * 60_000)
  const [, hour, dayOfMonth] = repeat.pattern.split(' ')
  if (dayOfMonth !== '*') return 32 * 24 * 3600_000
  if (hour === '*') return 2 * 3600_000
  return 26 * 3600_000
}

type JobHealth = 'ok' | 'retard' | 'erreur' | 'jamais'

async function ping(): Promise<{ database: 'ok' | 'erreur'; redis: 'ok' | 'absent' | 'erreur' }> {
  let database: 'ok' | 'erreur' = 'ok'
  try { await prisma.$queryRaw`SELECT 1` } catch { database = 'erreur' }
  const client = sharedRedis()
  if (!client) return { database, redis: 'absent' }
  try {
    const pong = await Promise.race([client.ping(), new Promise<string>((_, reject) => setTimeout(() => reject(new Error('délai')), 2000))])
    return { database, redis: pong === 'PONG' ? 'ok' : 'erreur' }
  } catch {
    return { database, redis: 'erreur' }
  }
}

export async function getSystemHealth(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * 3600_000)
  const [{ database, redis }, etats, enAttente, echecs24h, paiementsBloques, incidentsOuverts, derniersIncidents] = await Promise.all([
    ping(),
    prisma.tacheEtat.findMany(),
    prisma.envoi.count({ where: { statut: { in: ['EN_ATTENTE', 'EN_COURS'] } } }),
    prisma.envoi.count({ where: { statut: 'ECHEC', updatedAt: { gte: dayAgo } } }),
    prisma.contribution.count({ where: blockedPaymentsWhere(now) }),
    prisma.incident.count({ where: { resoluLe: null } }),
    prisma.incident.findMany({ where: { resoluLe: null }, orderBy: { derniereFois: 'desc' }, take: 10 }),
  ])

  const byName = new Map(etats.map(e => [e.nom, e]))
  const taches = SCHEDULED_JOBS.map(job => {
    const etat = byName.get(job.name)
    let sante: JobHealth = 'jamais'
    if (etat?.dernierSucces || etat?.derniereErreur) {
      const lastOk = etat.dernierSucces?.getTime() ?? 0
      const lastKo = etat.derniereErreur?.getTime() ?? 0
      sante = lastKo > lastOk ? 'erreur' : now.getTime() - lastOk > maxGapMs(job.repeat) ? 'retard' : 'ok'
    }
    return {
      nom: job.name, libelle: job.label, sante,
      dernierSucces: etat?.dernierSucces ?? null, derniereErreur: etat?.derniereErreur ?? null,
      erreur: etat?.erreur ?? null, resultat: etat?.resultat ?? null,
    }
  })

  const critique = database === 'erreur' || taches.some(t => t.sante === 'erreur')
  const attention = redis === 'erreur' || incidentsOuverts > 0 || echecs24h > 0 || paiementsBloques > 0 || taches.some(t => t.sante === 'retard')
  return {
    statut: critique ? 'critique' : attention ? 'attention' : 'ok',
    genereLe: now,
    version: process.env.APP_VERSION ?? 'dev',
    database, redis, stockage: storageMode(),
    taches,
    envois: { enAttente, echecs24h },
    paiementsBloques,
    incidents: { ouverts: incidentsOuverts, derniers: derniersIncidents },
  }
}
