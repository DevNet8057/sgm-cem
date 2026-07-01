import axios from 'axios'
import twilio from 'twilio'
import { PrismaClient } from '@prisma/client'
import { sendEmail, sendEmailWithPdfAttachment } from './email'

const prisma = new PrismaClient()

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  return twilio(sid, token)
}

export async function sendSMS(to: string, body: string): Promise<boolean> {
  try {
    const client = getTwilioClient()
    const from = process.env.TWILIO_FROM
    if (!client || !from) { console.warn('[SMS] Twilio non configure'); return false }
    const phone = to.startsWith('+') ? to : `+237${to.replace(/\D/g, '')}`
    await client.messages.create({ to: phone, from, body })
    return true
  } catch (e) { console.error('[SMS]', e); return false }
}

export async function sendWhatsApp(phone: string, message: string): Promise<boolean> {
  try {
    const apiKey = process.env.DIALOG360_API_KEY
    if (!apiKey) { console.warn('[WhatsApp] non configure'); return false }
    const normalized = phone.startsWith('+') ? phone.slice(1) : `237${phone.replace(/\D/g, '')}`
    await axios.post('https://waba.360dialog.io/v1/messages',
      { messaging_product: 'whatsapp', to: normalized, type: 'text', text: { body: message } },
      { headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' } }
    )
    return true
  } catch (e) { console.error('[WhatsApp]', e); return false }
}

export async function sendWhatsAppDocument(phone: string, pdfUrl: string, caption: string): Promise<boolean> {
  try {
    const apiKey = process.env.DIALOG360_API_KEY
    if (!apiKey) return false
    const normalized = phone.startsWith('+') ? phone.slice(1) : `237${phone.replace(/\D/g, '')}`
    await axios.post('https://waba.360dialog.io/v1/messages',
      { messaging_product: 'whatsapp', to: normalized, type: 'document',
        document: { link: pdfUrl, caption, filename: 'recu-cem.pdf' } },
      { headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' } }
    )
    return true
  } catch (e) { console.error('[WhatsApp doc]', e); return false }
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
  } catch (e) { console.error('[InApp]', e) }
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
