import nodemailer, { type Transporter } from 'nodemailer'
import { AppError } from '../middleware/errorHandler'
import { getConfig, getConfigBool } from './config.service'

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
    auth: { user, pass },
  })
  transporterSignature = signature

  return transporter
}

/** Vérifie la configuration SMTP sans envoyer de message. */
export async function verifySmtpConnection(): Promise<void> {
  const host = getConfig('SMTP_HOST')
  const port = parseInt(getConfig('SMTP_PORT') ?? '587', 10)
  const secure = getConfig('SMTP_SECURE') === 'true'
  const user = getConfig('SMTP_USER')
  const pass = getConfig('SMTP_PASS')

  if (!host || !user || !pass) {
    throw new AppError('SMTP_NOT_CONFIGURED', 'La configuration SMTP est incomplète.', 400)
  }

  const client = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 8_000,
  })

  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      client.verify(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('SMTP verification timeout')), 10_000)
      }),
    ])
  } catch {
    throw new AppError(
      'SMTP_VERIFICATION_FAILED',
      'La connexion SMTP a échoué. Vérifiez les paramètres du serveur.',
      502,
    )
  } finally {
    if (timeout) clearTimeout(timeout)
    client.close()
  }
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

    console.log(`[Email] Envoye a ${options.to} : ${options.subject}`)
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
    html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
    text: body,
    attachments: [{
      filename: filename || 'recu-cem.pdf',
      content: pdfBuffer,
      contentType: 'application/pdf',
    }],
  })
}
