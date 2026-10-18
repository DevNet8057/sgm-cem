import nodemailer from 'nodemailer'
import { getConfig, getConfigBool } from './config.service'
import { escapeHtml } from './pdf-branding'

/** Texte brut → HTML sûr (le contenu peut venir d'un utilisateur). */
export function textToHtml(text: string): string {
  return `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`
}

export interface EmailOptions {
  to: string
  subject: string
  html: string
  text?: string
  attachments?: Array<{
    filename: string
    content: Buffer | string
    contentType?: string
  }>
}

// Transporter mis en cache par signature de config : si le DEVELOPER change
// les paramètres SMTP depuis le panneau, le prochain envoi reconstruit le
// client avec les nouvelles valeurs — sans redémarrage.
type Transporter = ReturnType<typeof nodemailer.createTransport>
let transporter: Transporter | null = null
let transporterSignature = ''

function getTransporter(): Transporter | null {
  const host = getConfig('SMTP_HOST')
  const port = parseInt(getConfig('SMTP_PORT') ?? '587', 10)
  const secure = getConfig('SMTP_SECURE') === 'true'
  const user = getConfig('SMTP_USER')
  const pass = getConfig('SMTP_PASS')

  if (!host || !user || !pass) {
    console.warn('[Email] SMTP non configure (SMTP_HOST/SMTP_USER/SMTP_PASS manquants)')
    return null
  }

  const signature = `${host}|${port}|${secure}|${user}|${pass}`
  if (transporter && signature === transporterSignature) return transporter

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    // Sans TLS implicite (port 587) : STARTTLS exigé, jamais d'identifiants en clair
    requireTLS: !secure && getConfig('SMTP_REQUIRE_TLS') !== 'false',
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  transporterSignature = signature

  return transporter
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    // Interrupteur section F du panneau développeur
    if (!getConfigBool('EMAIL_ENABLED', true)) {
      console.log('[Email] Désactivé via EMAIL_ENABLED — envoi ignoré')
      return false
    }

    const client = getTransporter()
    if (!client) return false

    await client.sendMail({
      from: `"CEM Melen" <${getConfig('SMTP_FROM') ?? getConfig('SMTP_USER')}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
    })

    // Adresse du destinataire jamais écrite dans les journaux
    console.log(`[Email] Envoyé : ${options.subject}`)
    return true
  } catch (e) {
    console.error('[Email]', e)
    return false
  }
}

export async function sendEmailWithPdfAttachment({
  to,
  subject,
  pdfBuffer,
  filename,
  body,
}: {
  to: string
  subject: string
  pdfBuffer: Buffer
  filename: string
  body: string
}): Promise<boolean> {
  return sendEmail({
    to,
    subject,
    html: textToHtml(body),
    text: body,
    attachments: [{
      filename: filename || 'recu-cem.pdf',
      content: pdfBuffer,
      contentType: 'application/pdf',
    }],
  })
}
