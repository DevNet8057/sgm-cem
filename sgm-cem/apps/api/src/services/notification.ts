import axios from 'axios'
import twilio from 'twilio'
import { PrismaClient } from '@prisma/client'
import { sendEmail, sendEmailWithPdfAttachment } from './email'
import { getConfig, getConfigBool } from './config.service'
import { sendPushToUser } from './push.service'

const prisma = new PrismaClient()

// Client Twilio reconstruit si les identifiants changent depuis le panneau
// développeur (lecture au moment de l'appel, pas au chargement du module).
let twilioClient: ReturnType<typeof twilio> | null = null
let twilioSignature = ''

function getTwilioClient() {
  const sid = getConfig('TWILIO_ACCOUNT_SID')
  const token = getConfig('TWILIO_AUTH_TOKEN')
  if (!sid || !token) return null
  const signature = `${sid}|${token}`
  if (twilioClient && signature === twilioSignature) return twilioClient
  twilioClient = twilio(sid, token)
  twilioSignature = signature
  return twilioClient
}

/**
 * Normalise un numéro camerounais/diaspora vers un format E.164 sans le "+".
 * - "+237677123456" ou "237677123456" (déjà préfixé) -> renvoyé tel quel (pas de double préfixe).
 * - "677123456" (9 chiffres, format local CM) -> préfixé "237".
 * - Tout autre numéro international déjà complet (diaspora, ex "33612345678") -> renvoyé tel quel.
 */
export function normalizePhoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (phone.trim().startsWith('+')) return digits
  if (digits.length === 9) return `237${digits}`
  return digits
}

/** Vrai si l'URL pointe vers une machine locale (inaccessible depuis les serveurs WhatsApp/Meta). */
function isLocallyHostedUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname.endsWith('.local')
  } catch {
    return true // URL invalide -> on considère qu'elle n'est pas exploitable
  }
}

export async function sendSMS(to: string, body: string): Promise<boolean> {
  try {
    if (!getConfigBool('SMS_ENABLED', true)) { console.log('[SMS] Désactivé via SMS_ENABLED'); return false }
    const client = getTwilioClient()
    const from = getConfig('TWILIO_FROM')
    if (!client || !from) { console.warn('[SMS] Twilio non configure'); return false }
    const phone = `+${normalizePhoneDigits(to)}`
    await client.messages.create({ to: phone, from, body })
    return true
  } catch (e) { console.error('[SMS]', e); return false }
}

export async function sendWhatsApp(phone: string, message: string): Promise<boolean> {
  try {
    if (!getConfigBool('WHATSAPP_ENABLED', true)) { console.log('[WhatsApp] Désactivé via WHATSAPP_ENABLED'); return false }
    const apiKey = getConfig('DIALOG360_API_KEY')
    if (!apiKey) { console.warn('[WhatsApp] DIALOG360_API_KEY non configuree — message non envoye'); return false }
    const normalized = normalizePhoneDigits(phone)
    const resp = await axios.post('https://waba.360dialog.io/v1/messages',
      { messaging_product: 'whatsapp', to: normalized, type: 'text', text: { body: message } },
      { headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' } }
    )
    if (resp.data?.errors?.length) { console.error('[WhatsApp] erreurs API:', resp.data.errors); return false }
    return true
  } catch (e) {
    if (axios.isAxiosError(e)) console.error('[WhatsApp]', e.response?.status, e.response?.data ?? e.message)
    else console.error('[WhatsApp]', e)
    return false
  }
}

export async function sendWhatsAppDocument(phone: string, pdfUrl: string, caption: string): Promise<boolean> {
  try {
    // Décision produit (2026-07-05) : le reçu n'est PLUS envoyé automatiquement
    // par WhatsApp — il est présenté dans l'app avec Partager/Imprimer.
    // Les appelants retombent sur un message texte de confirmation.
    // Réactivable depuis le panneau développeur (section Notifications).
    if (!getConfigBool('AUTO_SEND_RECEIPT_WHATSAPP', false)) {
      console.log('[WhatsApp doc] Envoi auto du reçu désactivé (AUTO_SEND_RECEIPT_WHATSAPP)')
      return false
    }
    if (!getConfigBool('WHATSAPP_ENABLED', true)) { console.log('[WhatsApp doc] Désactivé via WHATSAPP_ENABLED'); return false }
    const apiKey = getConfig('DIALOG360_API_KEY')
    if (!apiKey) { console.warn('[WhatsApp doc] DIALOG360_API_KEY non configuree — document non envoye'); return false }
    if (isLocallyHostedUrl(pdfUrl)) {
      console.warn(`[WhatsApp doc] URL non joignable depuis WhatsApp (${pdfUrl}) — configurez S3/R2 (voir .env) pour permettre l'envoi de documents. Repli sur message texte.`)
      return false
    }
    const normalized = normalizePhoneDigits(phone)
    const resp = await axios.post('https://waba.360dialog.io/v1/messages',
      { messaging_product: 'whatsapp', to: normalized, type: 'document',
        document: { link: pdfUrl, caption, filename: 'recu-cem.pdf' } },
      { headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' } }
    )
    if (resp.data?.errors?.length) { console.error('[WhatsApp doc] erreurs API:', resp.data.errors); return false }
    return true
  } catch (e) {
    if (axios.isAxiosError(e)) console.error('[WhatsApp doc]', e.response?.status, e.response?.data ?? e.message)
    else console.error('[WhatsApp doc]', e)
    return false
  }
}

export async function notifyInApp(
  userId: string, title: string, body: string, type = 'INFO', data?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId, title, body, type, isRead: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(data ? { data: data as any } : {}),
      }
    })
    // Doubler d'un push navigateur (barre de notification système) —
    // best-effort : ne bloque jamais la notification in-app.
    void sendPushToUser(userId, { title, body, data })
  } catch (e) { console.error('[InApp]', e) }
}

/**
 * Alerte tous les Trésoriers/Admin d'une anomalie nécessitant une résolution manuelle
 * (ex: montant incohérent entre l'initiation et la confirmation d'un paiement).
 */
export async function alertTresoriers(title: string, body: string, data?: Record<string, unknown>): Promise<void> {
  const tresoriers = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'DEVELOPER', 'TRESORIER'] }, isActive: true },
    select: { id: true },
  })
  await Promise.all(tresoriers.map(t => notifyInApp(t.id, title, body, 'ALERTE', data)))
}

export async function notifyCollecteurNewContribution(p: {
  collecteurId: string; collecteurPhone?: string | null
  memberName: string; montant: number; rubriqueCode: string
}): Promise<void> {
  const msg = `CEM Melen - Nouveau paiement a confirmer\nMembre: ${p.memberName}\nMontant: ${p.montant.toLocaleString('fr-FR')} FCFA\nRubrique: ${p.rubriqueCode}\nConnectez-vous sur SGM-CEM pour valider.`
  await notifyInApp(p.collecteurId, 'Paiement a confirmer',
    `${p.memberName} - ${p.montant.toLocaleString('fr-FR')} FCFA (${p.rubriqueCode})`, 'CONTRIBUTION')
  if (p.collecteurPhone) {
    const ok = await sendWhatsApp(p.collecteurPhone, msg)
    if (!ok) await sendSMS(p.collecteurPhone, msg.substring(0, 160))
  }
}

export async function notifyMemberConfirmed(p: {
  userId: string; memberPhone?: string | null; memberEmail?: string | null
  memberName: string; montant: number; rubriqueCode: string; receiptUrl?: string; contributionId?: string
}): Promise<void> {
  const msg = `CEM Melen - Paiement confirme\nMembre: ${p.memberName}\nMontant: ${p.montant.toLocaleString('fr-FR')} FCFA\nRubrique: ${p.rubriqueCode}\nMerci pour votre contribution !`
  await notifyInApp(p.userId, 'Paiement confirme',
    `Votre contribution de ${p.montant.toLocaleString('fr-FR')} FCFA (${p.rubriqueCode}) a ete confirmee.`, 'CONTRIBUTION')

  // WhatsApp avec document PDF si disponible
  if (p.memberPhone) {
    if (p.receiptUrl) {
      const ok = await sendWhatsAppDocument(p.memberPhone, p.receiptUrl, msg)
      if (!ok) await sendWhatsApp(p.memberPhone, msg)
    } else {
      const ok = await sendWhatsApp(p.memberPhone, msg)
      if (!ok) await sendSMS(p.memberPhone, msg.substring(0, 160))
    }
  }

  // Email avec PDF si disponible
  if (p.memberEmail) {
    try {
      let pdfBuffer: Buffer | undefined
      let filename = 'recu-cem.pdf'

      if (p.contributionId) {
        const { generateReceiptPdf } = await import('./receipt')
        pdfBuffer = await generateReceiptPdf(p.contributionId)
      }

      if (pdfBuffer) {
        const ok = await sendEmailWithPdfAttachment({
          to: p.memberEmail,
          subject: `Recu de contribution - ${p.rubriqueCode}`,
          pdfBuffer,
          filename,
          body: msg,
        })
        if (!ok) await sendEmail({ to: p.memberEmail, subject: `Recu de contribution - ${p.rubriqueCode}`, html: `<p>${msg.replace(/\n/g, '<br>')}</p>` })
      } else {
        await sendEmail({ to: p.memberEmail, subject: `Recu de contribution - ${p.rubriqueCode}`, html: `<p>${msg.replace(/\n/g, '<br>')}</p>` })
      }
    } catch (e) { console.error('[Email recu]', e) }
  }
}

export async function notifyMobilePaymentInitiated(p: {
  userId: string; phone: string; montant: number; provider: 'MTN_MOMO' | 'ORANGE_MONEY'
}): Promise<void> {
  const label = p.provider === 'MTN_MOMO' ? 'MTN MoMo' : 'Orange Money'
  const msg = `CEM Melen - Demande ${label}\nValidez le paiement de ${p.montant.toLocaleString('fr-FR')} FCFA sur votre telephone.\nEntrez votre code PIN ${label} pour confirmer.`
  await notifyInApp(p.userId, `Demande ${label} envoyee`,
    `Validez ${p.montant.toLocaleString('fr-FR')} FCFA sur votre ${label}.`, 'CONTRIBUTION')
  await sendWhatsApp(p.phone, msg)
}

export async function sendMonthlyStatement(p: {
  userId: string; phone?: string | null; memberName: string; month: string
  totalConfirmed: number; totalPending: number
  contributions: Array<{ rubrique: string; montant: number; statut: string }>
}): Promise<void> {
  const lines = p.contributions.map(c => `${c.rubrique}: ${c.montant.toLocaleString('fr-FR')} FCFA (${c.statut})`).join('\n')
  const msg = `CEM Melen - Releve ${p.month}\nMembre: ${p.memberName}\nConfirme: ${p.totalConfirmed.toLocaleString('fr-FR')} FCFA\nEn attente: ${p.totalPending.toLocaleString('fr-FR')} FCFA\n\nDetail:\n${lines}\n\nMerci pour votre fidelite !`
  await notifyInApp(p.userId, `Releve ${p.month}`, `Confirme: ${p.totalConfirmed.toLocaleString('fr-FR')} FCFA`, 'INFO')
  if (p.phone) {
    const ok = await sendWhatsApp(p.phone, msg)
    if (!ok) await sendSMS(p.phone, msg.substring(0, 160))
  }
}
