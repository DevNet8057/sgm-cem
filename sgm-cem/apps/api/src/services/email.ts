import nodemailer from 'nodemailer'

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

let transporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter

  const host = process.env.SMTP_HOST
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10)
  const secure = process.env.SMTP_SECURE === 'true'
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !user || !pass) {
    console.warn('[Email] SMTP non configure (SMTP_HOST/SMTP_USER/SMTP_PASS manquants)')
    return null
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  })

  return transporter
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    const client = getTransporter()
    if (!client) return false

    await client.sendMail({
      from: `"CEM Melen" <${process.env.SMTP_FROM ?? process.env.SMTP_USER}>`,
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
