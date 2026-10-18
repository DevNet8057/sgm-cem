import axios from 'axios'
import twilio from 'twilio'
import { deliverEmail, deliverMessage } from './outbox.service'
import { getConfig, getConfigBool } from './config.service'
import { sendPushToUser } from './push.service'
import { getPrisma } from '../lib/prisma'

const prisma = getPrisma()

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

// API Cloud de 360dialog (l'ancienne adresse waba.360dialog.io/v1 est celle de l'API « On-Premise »)
const DEFAULT_DIALOG360_URL = 'https://waba-v2.360dialog.io'
const WHATSAPP_TIMEOUT_MS = 10_000

/**
 * Modèle de message approuvé par Meta. Hors de la fenêtre de 24 h ouverte par un
 * message du destinataire, WhatsApp n'accepte QUE des modèles : `configKey` est le
 * réglage (panneau développeur) qui porte le nom du modèle créé chez 360dialog.
 * `otpCode` : modèle d'authentification (bouton « copier le code »).
 */
export interface WhatsAppTemplate {
  configKey: string
  params: string[]
  otpCode?: string
}

/** Corps de l'appel pour un modèle (format de l'API Cloud de Meta). */
export function templateMessage(name: string, language: string, t: WhatsAppTemplate) {
  const components: Array<Record<string, unknown>> = []
  if (t.params.length) components.push({ type: 'body', parameters: t.params.map(text => ({ type: 'text', text })) })
  if (t.otpCode) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: t.otpCode }] })
  return { type: 'template', template: { name, language: { code: language }, components } }
}

async function postWhatsApp(label: string, phone: string, message: Record<string, unknown>): Promise<boolean> {
  const apiKey = getConfig('DIALOG360_API_KEY')
  if (!apiKey) { console.warn(`${label} DIALOG360_API_KEY non configurée — message non envoyé`); return false }
  const base = (getConfig('DIALOG360_BASE_URL') || DEFAULT_DIALOG360_URL).replace(/\/+$/, '')
  try {
    const resp = await axios.post(`${base}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to: normalizePhoneDigits(phone), ...message },
      { headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' }, timeout: WHATSAPP_TIMEOUT_MS }
    )
    if (resp.data?.errors?.length || resp.data?.error) { console.error(`${label} erreurs API:`, resp.data.errors ?? resp.data.error); return false }
    return true
  } catch (e) {
    if (axios.isAxiosError(e)) console.error(label, e.response?.status, e.response?.data ?? e.message)
    else console.error(label, e)
    return false
  }
}

/**
 * Envoie un message WhatsApp : par le modèle indiqué s'il est réglé, sinon en texte
 * libre (délivré seulement si le destinataire a écrit au numéro dans les 24 h).
 */
export async function sendWhatsApp(phone: string, message: string, template?: WhatsAppTemplate): Promise<boolean> {
  if (!getConfigBool('WHATSAPP_ENABLED', true)) { console.log('[WhatsApp] Désactivé via WHATSAPP_ENABLED'); return false }
  const name = template ? getConfig(template.configKey)?.trim() : undefined
  if (template && !name) console.warn(`[WhatsApp] Modèle ${template.configKey} non réglé : message libre, refusé par WhatsApp hors fenêtre de 24 h`)
  const body = template && name
    ? templateMessage(name, getConfig('WHATSAPP_TEMPLATE_LANG')?.trim() || 'fr', template)
    : { type: 'text', text: { body: message } }
  return postWhatsApp('[WhatsApp]', phone, body)
}

export async function sendWhatsAppDocument(phone: string, pdfUrl: string, caption: string): Promise<boolean> {
  // Décision produit (2026-07-05) : le reçu n'est PLUS envoyé automatiquement
  // par WhatsApp — il est présenté dans l'app avec Partager/Imprimer.
  // Les appelants retombent sur un message texte de confirmation.
  // Réactivable depuis le panneau développeur (section Notifications).
  if (!getConfigBool('AUTO_SEND_RECEIPT_WHATSAPP', false)) {
    console.log('[WhatsApp doc] Envoi auto du reçu désactivé (AUTO_SEND_RECEIPT_WHATSAPP)')
    return false
  }
  if (!getConfigBool('WHATSAPP_ENABLED', true)) { console.log('[WhatsApp doc] Désactivé via WHATSAPP_ENABLED'); return false }
  if (isLocallyHostedUrl(pdfUrl)) {
    console.warn(`[WhatsApp doc] URL non joignable depuis WhatsApp (${pdfUrl}) — configurez S3/R2 (voir .env) pour permettre l'envoi de documents. Repli sur message texte.`)
    return false
  }
  return postWhatsApp('[WhatsApp doc]', phone, { type: 'document', document: { link: pdfUrl, caption, filename: 'recu-cem.pdf' } })
}

/**
 * Cible de redirection au clic — réutilise exactement les valeurs de
 * `activeView` (Sidebar/dashboard router), voir schema.prisma Notification.
 */
export interface NotificationTarget {
  view: string
  id?: string
}

/** URL ouverte au clic sur la notification système (une URL par écran côté web). */
function pushTarget(target?: NotificationTarget | null): { url?: string } {
  if (!target?.view || !/^[a-z][a-z-]{1,40}$/.test(target.view)) return {}
  return { url: target.view === 'dashboard' ? '/dashboard' : `/dashboard/${target.view}` }
}

export async function notifyInApp(
  userId: string, title: string, body: string, type = 'INFO',
  data?: Record<string, unknown>, target?: NotificationTarget
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId, title, body, type, isRead: false,
        targetView: target?.view,
        targetId: target?.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(data ? { data: data as any } : {}),
      }
    })
    // Doubler d'un push navigateur (barre de notification système) —
    // best-effort : ne bloque jamais la notification in-app.
    void sendPushToUser(userId, { title, body, data: { ...data, ...pushTarget(target) } })
  } catch (e) { console.error('[InApp]', e) }
}

/**
 * Informe chaque compte actif d'une nouvelle collecte ouverte au public.
 * Le créateur est volontairement inclus : il retrouve aussi l'événement dans
 * son propre centre de notifications, comme les autres utilisateurs.
 */
export async function notifyPublicCollecteCreated(p: {
  collecteId: string
  titre: string
  isUrgent: boolean
}): Promise<void> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, role: true },
  })
  const title = p.isUrgent ? 'Nouvelle collecte publique urgente' : 'Nouvelle collecte publique'
  const body = p.isUrgent
    ? `La collecte « ${p.titre} » est ouverte et signalée urgente.`
    : `La collecte « ${p.titre} » est maintenant ouverte au public.`
  const data = { collecteId: p.collecteId, isUrgent: p.isUrgent }

  await prisma.notification.createMany({
    data: users.map(user => {
      const canManagePublicCollectes = ['ADMIN', 'TRESORIER', 'DEVELOPER'].includes(user.role)
      return {
        userId: user.id,
        title,
        body,
        type: p.isUrgent ? 'ALERTE' : 'INFO',
        targetView: canManagePublicCollectes ? 'collectes-publiques' : 'rubriques',
        targetId: canManagePublicCollectes ? p.collecteId : null,
        data,
        statut: 'SENT',
        sentAt: new Date(),
      }
    }),
  })

  for (const user of users) {
    const canManagePublicCollectes = ['ADMIN', 'TRESORIER', 'DEVELOPER'].includes(user.role)
    void sendPushToUser(user.id, { title, body, data: { ...data, ...pushTarget({ view: canManagePublicCollectes ? 'collectes-publiques' : 'rubriques' }) } })
  }
}

/** Notifie tous les comptes actifs lorsqu'une collecte devient (ou cesse d'être) urgente. */
export async function notifyPublicCollecteUrgencyChanged(p: {
  collecteId: string
  titre: string
  isUrgent: boolean
}): Promise<void> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, role: true },
  })
  const title = p.isUrgent ? 'Collecte marquée urgente' : 'Collecte retirée des urgences'
  const body = p.isUrgent
    ? `La collecte « ${p.titre} » demande une attention prioritaire.`
    : `La collecte « ${p.titre} » n'est plus signalée comme urgente.`
  const data = { collecteId: p.collecteId, isUrgent: p.isUrgent }

  await prisma.notification.createMany({
    data: users.map(user => {
      const canManagePublicCollectes = ['ADMIN', 'TRESORIER', 'DEVELOPER'].includes(user.role)
      return {
        userId: user.id,
        title,
        body,
        type: p.isUrgent ? 'ALERTE' : 'INFO',
        targetView: canManagePublicCollectes ? 'collectes-publiques' : 'rubriques',
        targetId: canManagePublicCollectes ? p.collecteId : null,
        data,
        statut: 'SENT',
        sentAt: new Date(),
      }
    }),
  })

  for (const user of users) {
    const canManagePublicCollectes = ['ADMIN', 'TRESORIER', 'DEVELOPER'].includes(user.role)
    void sendPushToUser(user.id, { title, body, data: { ...data, ...pushTarget({ view: canManagePublicCollectes ? 'collectes-publiques' : 'rubriques' }) } })
  }
}

/**
 * Alerte tous les Trésoriers/Admin d'une anomalie nécessitant une résolution manuelle
 * (ex: montant incohérent entre l'initiation et la confirmation d'un paiement).
 */
export async function alertTresoriers(
  title: string, body: string, data?: Record<string, unknown>, target?: NotificationTarget
): Promise<void> {
  const tresoriers = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'DEVELOPER', 'TRESORIER'] }, isActive: true },
    select: { id: true },
  })
  await Promise.all(tresoriers.map(t => notifyInApp(t.id, title, body, 'ALERTE', data, target)))
}

export async function notifyCollecteurNewContribution(p: {
  collecteurId: string; collecteurPhone?: string | null
  memberName: string; montant: number; rubriqueCode: string; contributionId: string
}): Promise<void> {
  const msg = `CEM Melen - Nouveau paiement a confirmer\nMembre: ${p.memberName}\nMontant: ${p.montant.toLocaleString('fr-FR')} FCFA\nRubrique: ${p.rubriqueCode}\nConnectez-vous sur SGM-CEM pour valider.`
  await notifyInApp(p.collecteurId, 'Paiement à confirmer',
    `${p.memberName} - ${p.montant.toLocaleString('fr-FR')} FCFA (${p.rubriqueCode})`, 'CONTRIBUTION',
    undefined, { view: 'validations', id: p.contributionId })
  if (p.collecteurPhone) {
    await deliverMessage('paiement-a-confirmer', p.collecteurPhone, {
      text: msg,
      smsText: `CEM Melen - Paiement a confirmer : ${p.memberName}, ${p.montant.toLocaleString('fr-FR')} FCFA (${p.rubriqueCode}). Validez dans SGM-CEM.`,
      template: { configKey: 'WHATSAPP_TEMPLATE_A_CONFIRMER', params: [p.memberName, `${p.montant.toLocaleString('fr-FR')} FCFA`, p.rubriqueCode] },
    })
  }
}

export async function notifyMemberConfirmed(p: {
  userId: string; memberPhone?: string | null; memberEmail?: string | null
  memberName: string; montant: number; rubriqueCode: string; receiptUrl?: string | null; contributionId?: string
}): Promise<void> {
  const msg = `CEM Melen - Paiement confirme\nMembre: ${p.memberName}\nMontant: ${p.montant.toLocaleString('fr-FR')} FCFA\nRubrique: ${p.rubriqueCode}\nMerci pour votre contribution !`
  await notifyInApp(p.userId, 'Paiement confirmé',
    `Votre contribution de ${p.montant.toLocaleString('fr-FR')} FCFA (${p.rubriqueCode}) a été confirmée.`, 'CONTRIBUTION',
    undefined, { view: 'mes-contributions', id: p.contributionId })

  // WhatsApp avec le reçu en document si l'envoi automatique est activé, sinon message
  // (modèle « paiement confirmé ») ou SMS ; e-mail avec le reçu PDF. Nouveaux essais par la file.
  const confirmedTemplate: WhatsAppTemplate = { configKey: 'WHATSAPP_TEMPLATE_PAIEMENT_CONFIRME', params: [p.memberName, `${p.montant.toLocaleString('fr-FR')} FCFA`, p.rubriqueCode] }
  if (p.memberPhone) {
    const documentSent = p.receiptUrl ? await sendWhatsAppDocument(p.memberPhone, p.receiptUrl, msg) : false
    if (!documentSent) {
      await deliverMessage('paiement-confirme', p.memberPhone, {
        text: msg,
        smsText: `CEM Melen - Paiement confirme : ${p.montant.toLocaleString('fr-FR')} FCFA (${p.rubriqueCode}). Merci !`,
        template: confirmedTemplate,
      })
    }
  }
  if (p.memberEmail) {
    await deliverEmail('recu', p.memberEmail, { subject: `Reçu de contribution - ${p.rubriqueCode}`, text: msg, receiptOf: p.contributionId })
  }
}

export async function notifyMobilePaymentInitiated(p: {
  userId: string; phone: string; montant: number; provider: 'MTN_MOMO' | 'ORANGE_MONEY'
}): Promise<void> {
  const label = p.provider === 'MTN_MOMO' ? 'MTN MoMo' : 'Orange Money'
  const msg = `CEM Melen - Demande ${label}\nValidez le paiement de ${p.montant.toLocaleString('fr-FR')} FCFA sur votre telephone.\nEntrez votre code PIN ${label} pour confirmer.`
  await notifyInApp(p.userId, `Demande ${label} envoyee`,
    `Validez ${p.montant.toLocaleString('fr-FR')} FCFA sur votre ${label}.`, 'CONTRIBUTION')
  await deliverMessage('paiement-initie', p.phone, { text: msg, template: { configKey: 'WHATSAPP_TEMPLATE_PAIEMENT_INITIE', params: [label, `${p.montant.toLocaleString('fr-FR')} FCFA`] } })
}

export async function sendMonthlyStatement(p: {
  userId: string; phone?: string | null; memberName: string; month: string
  totalConfirmed: number; totalPending: number
  contributions: Array<{ rubrique: string; montant: number; statut: string }>
}): Promise<boolean> {
  const lines = p.contributions.map(c => `${c.rubrique}: ${c.montant.toLocaleString('fr-FR')} FCFA (${c.statut})`).join('\n')
  const msg = `CEM Melen - Releve ${p.month}\nMembre: ${p.memberName}\nConfirme: ${p.totalConfirmed.toLocaleString('fr-FR')} FCFA\nEn attente: ${p.totalPending.toLocaleString('fr-FR')} FCFA\n\nDetail:\n${lines}\n\nMerci pour votre fidelite !`
  await notifyInApp(p.userId, `Releve ${p.month}`, `Confirme: ${p.totalConfirmed.toLocaleString('fr-FR')} FCFA`, 'INFO')
  if (!p.phone) return false
  const confirmed = `${p.totalConfirmed.toLocaleString('fr-FR')} FCFA`
  const pending = `${p.totalPending.toLocaleString('fr-FR')} FCFA`
  // Le détail ne tient pas dans un SMS : résumé seulement (le détail reste dans l'application)
  return deliverMessage('releve', p.phone, {
    text: msg,
    smsText: `CEM Melen - Releve ${p.month} : confirme ${confirmed}, en attente ${pending}. Detail dans SGM-CEM.`,
    template: { configKey: 'WHATSAPP_TEMPLATE_RELEVE', params: [p.memberName, p.month, confirmed, pending] },
  })
}
