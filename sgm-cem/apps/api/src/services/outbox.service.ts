// File des envois externes : chaque message est enregistré (table envois), tenté
// tout de suite, puis réessayé par la tâche « envois-relance » (1 min, 5 min,
// 30 min) jusqu'à 4 essais. L'état de livraison reste consultable ; aucun envoi
// n'est perdu en silence. Sans canal réglé, rien n'est réessayé (NON_CONFIGURE).
import type { Envoi, Prisma } from '@prisma/client'
import { getPrisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { getConfig, getConfigBool } from './config.service'
import { sendEmail, textToHtml } from './email'
import { sendSMS, sendWhatsApp, type WhatsAppTemplate } from './notification'

const prisma = getPrisma()
const MAX_ESSAIS = 4
const DELAIS_MIN = [1, 5, 30] // avant les essais 2, 3 et 4
const EN_COURS_BLOQUE_MS = 10 * 60_000

export interface MessagePayload {
  text: string
  // Texte court pour le SMS de secours (sans lui : texte complet)
  smsText?: string
  template?: WhatsAppTemplate
}

export interface EmailPayload {
  subject: string
  text: string
  // Joindre le reçu PDF de cette contribution (régénéré à chaque essai)
  receiptOf?: string
}

function messageChannelsConfigured(): boolean {
  const whatsapp = getConfigBool('WHATSAPP_ENABLED', true) && Boolean(getConfig('DIALOG360_API_KEY'))
  const sms = getConfigBool('SMS_ENABLED', true) && Boolean(getConfig('TWILIO_ACCOUNT_SID') && getConfig('TWILIO_AUTH_TOKEN') && getConfig('TWILIO_FROM'))
  return whatsapp || sms
}

function emailConfigured(): boolean {
  return getConfigBool('EMAIL_ENABLED', true) && Boolean(getConfig('SMTP_HOST') && getConfig('SMTP_USER') && getConfig('SMTP_PASS'))
}

async function attempt(envoi: Pick<Envoi, 'canal' | 'destinataire' | 'payload'>): Promise<{ voie: string } | { erreur: string }> {
  if (envoi.canal === 'MESSAGE') {
    const p = envoi.payload as unknown as MessagePayload
    if (await sendWhatsApp(envoi.destinataire, p.text, p.template)) return { voie: 'WHATSAPP' }
    if (await sendSMS(envoi.destinataire, p.smsText ?? p.text)) return { voie: 'SMS' }
    return { erreur: 'WhatsApp et SMS en échec' }
  }
  const p = envoi.payload as unknown as EmailPayload
  let attachments: Array<{ filename: string; content: Buffer; contentType: string }> | undefined
  if (p.receiptOf) {
    const { generateReceiptPdf } = await import('./receipt')
    const pdf = await generateReceiptPdf(p.receiptOf).catch(() => null)
    // Sans PDF (moteur indisponible), le courriel part quand même, sans pièce jointe
    if (pdf) attachments = [{ filename: 'recu-cem.pdf', content: pdf, contentType: 'application/pdf' }]
  }
  const ok = await sendEmail({ to: envoi.destinataire, subject: p.subject, text: p.text, html: textToHtml(p.text), attachments })
  return ok ? { voie: 'EMAIL' } : { erreur: 'Envoi SMTP en échec' }
}

/** Résultat d'un essai : envoyé, nouvel essai programmé, ou abandon. */
async function settle(envoi: Envoi, result: { voie: string } | { erreur: string }, now: Date): Promise<boolean> {
  const essais = envoi.essais + 1
  if ('voie' in result) {
    await prisma.envoi.update({ where: { id: envoi.id }, data: { statut: 'ENVOYE', voie: result.voie, essais, envoyeLe: now, prochainEssai: null, derniereErreur: null } })
    return true
  }
  const prochain = new Date(now.getTime() + (DELAIS_MIN[essais - 1] ?? 0) * 60_000)
  const abandon = essais >= MAX_ESSAIS || (envoi.expireLe !== null && prochain > envoi.expireLe)
  await prisma.envoi.update({
    where: { id: envoi.id },
    data: { statut: abandon ? 'ECHEC' : 'EN_ATTENTE', essais, derniereErreur: result.erreur, prochainEssai: abandon ? null : prochain },
  })
  if (abandon) logger.warn({ envoiId: envoi.id, objet: envoi.objet, essais }, '[Envois] Abandon après échecs')
  return false
}

async function enqueue(canal: 'MESSAGE' | 'EMAIL', objet: string, destinataire: string, payload: MessagePayload | EmailPayload, expireLe?: Date): Promise<boolean> {
  const configured = canal === 'MESSAGE' ? messageChannelsConfigured() : emailConfigured()
  const envoi = await prisma.envoi.create({
    data: {
      canal, objet, destinataire, payload: payload as unknown as Prisma.InputJsonValue, expireLe,
      statut: configured ? 'EN_COURS' : 'NON_CONFIGURE',
      derniereErreur: configured ? null : 'Aucun canal réglé',
    },
  })
  if (!configured) return false
  return settle(envoi, await attempt(envoi), new Date())
}

/** Message au téléphone : WhatsApp (modèle s'il est réglé), SMS en secours, nouveaux essais. */
export function deliverMessage(objet: string, phone: string, payload: MessagePayload, opts: { expiresAt?: Date } = {}): Promise<boolean> {
  return enqueue('MESSAGE', objet, phone, payload, opts.expiresAt)
}

/** Courriel, avec le reçu PDF en pièce jointe si demandé ; nouveaux essais. */
export function deliverEmail(objet: string, to: string, payload: EmailPayload): Promise<boolean> {
  return enqueue('EMAIL', objet, to, payload)
}

/** Tâche « envois-relance » : nouveaux essais arrivés à échéance. */
export async function runOutboxRetries(now = new Date()): Promise<{ essais: number; envoyes: number }> {
  const dus = await prisma.envoi.findMany({
    where: {
      OR: [
        { statut: 'EN_ATTENTE', prochainEssai: { lte: now } },
        // Essai interrompu (processus arrêté pendant l'envoi)
        { statut: 'EN_COURS', updatedAt: { lt: new Date(now.getTime() - EN_COURS_BLOQUE_MS) } },
      ],
    },
    orderBy: { prochainEssai: 'asc' },
    take: 50,
  })
  let envoyes = 0
  let essais = 0
  for (const envoi of dus) {
    if (envoi.expireLe && envoi.expireLe < now) {
      await prisma.envoi.updateMany({ where: { id: envoi.id, statut: envoi.statut }, data: { statut: 'ECHEC', derniereErreur: 'Délai dépassé', prochainEssai: null } })
      continue
    }
    // Un seul processus prend l'envoi
    const claimed = await prisma.envoi.updateMany({ where: { id: envoi.id, statut: envoi.statut, essais: envoi.essais }, data: { statut: 'EN_COURS' } })
    if (claimed.count !== 1) continue
    essais++
    if (await settle(envoi, await attempt(envoi), now)) envoyes++
  }
  return { essais, envoyes }
}
