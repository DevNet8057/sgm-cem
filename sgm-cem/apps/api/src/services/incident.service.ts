// Suivi d'erreurs (point 17) : tâches planifiées, webhooks des prestataires et
// envois abandonnés laissent une trace consultable par l'administration
// (santé du système), en plus de Sentry quand SENTRY_DSN est réglé.
// Une même erreur répétée est regroupée ; le message est expurgé des données
// personnelles (loi n° 2024/017) : ni téléphone, ni e-mail, ni jeton.
import type { IncidentSource } from '@prisma/client'
import { getPrisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { captureError } from '../lib/error-tracking'
import { notifyInApp } from './notification'

const prisma = getPrisma()

/** Message d'erreur sans donnée personnelle, borné à 300 caractères. */
export function redactMessage(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : JSON.stringify(raw) ?? String(raw)
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]')
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 [jeton]')
    .replace(/\+?\d[\d\s.-]{7,}\d/g, '[numéro]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300) || 'Erreur sans message'
}

/**
 * Enregistre un incident (ou incrémente l'incident ouvert identique).
 * Ne lève jamais : le suivi d'erreurs ne doit pas casser le traitement suivi.
 */
export async function recordIncident(source: IncidentSource, code: string, error: unknown): Promise<void> {
  const message = redactMessage(error)
  try {
    captureError(error instanceof Error ? error : new Error(message), { source, code })
    const open = await prisma.incident.findFirst({ where: { source, code, message, resoluLe: null }, select: { id: true } })
    if (open) {
      await prisma.incident.update({ where: { id: open.id }, data: { occurrences: { increment: 1 }, derniereFois: new Date() } })
      return
    }
    await prisma.incident.create({ data: { source, code, message } })
    // Première occurrence : l'administration est prévenue une seule fois
    const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'DEVELOPER'] }, isActive: true }, select: { id: true } })
    await Promise.all(admins.map(a => notifyInApp(a.id, 'Incident technique', `${LABELS[source]} « ${code} » : ${message}`, 'ALERTE', undefined, { view: 'dashboard' })))
  } catch (e) {
    logger.error({ err: (e as Error).message, source, code }, 'Suivi d’erreurs : enregistrement impossible')
  }
}

const LABELS: Record<IncidentSource, string> = { TACHE: 'Tâche planifiée', WEBHOOK: 'Webhook', ENVOI: 'Envoi' }

/** Exécute une tâche planifiée en notant son début, son succès ou son échec. */
export async function runTracked<T>(nom: string, run: () => Promise<T>): Promise<T> {
  const debut = new Date()
  await safeUpsert(nom, { dernierDebut: debut })
  try {
    const result = await run()
    await safeUpsert(nom, { dernierSucces: new Date(), dureeMs: Date.now() - debut.getTime(), resultat: summarize(result) })
    return result
  } catch (err) {
    await safeUpsert(nom, { derniereErreur: new Date(), erreur: redactMessage(err), dureeMs: Date.now() - debut.getTime() })
    await recordIncident('TACHE', nom, err)
    throw err
  }
}

function summarize(result: unknown): string | null {
  if (result === undefined || result === null) return null
  const text = typeof result === 'string' ? result : JSON.stringify(result)
  return text ? redactMessage(text).slice(0, 200) : null
}

async function safeUpsert(nom: string, data: Record<string, unknown>): Promise<void> {
  try {
    await prisma.tacheEtat.upsert({ where: { nom }, create: { nom, ...data }, update: data })
  } catch (e) {
    logger.warn({ err: (e as Error).message, nom }, 'État de tâche non enregistré')
  }
}
