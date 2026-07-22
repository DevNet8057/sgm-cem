import puppeteer from 'puppeteer'
import { PrismaClient } from '@prisma/client'
import { storeFile } from './storage'
import { getLogoDataUri, formatXAF, formatDate, formatDateTime } from './pdf-branding'

const prisma = new PrismaClient()

function getPrisma(): PrismaClient {
  return prisma
}

const MODE_LABELS: Record<string, string> = {
  ESPECES: 'Espèces', MTN_MOMO: 'MTN MoMo', ORANGE_MONEY: 'Orange Money',
  YELII: 'Mobile Money (Yelii)', CARTE_VISA: 'Carte bancaire', VIREMENT: 'Virement bancaire',
}

const STATUT_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  CONFIRME: { label: 'PAIEMENT CONFIRMÉ', color: '#0F4A0F', bg: '#E8F5E8' },
  EN_ATTENTE_CONFIRMATION: { label: 'EN ATTENTE DE CONFIRMATION', color: '#92400E', bg: '#FFFBEB' },
  ANNULE: { label: 'PAIEMENT ANNULÉ', color: '#991B1B', bg: '#FEF2F2' },
  LITIGE: { label: 'EN LITIGE', color: '#991B1B', bg: '#FEF2F2' },
}

/** Numéro de reçu lisible et stable, dérivé de l'ID — pas de compteur séparé à maintenir. */
function invoiceNumber(contribution: { id: string; createdAt: Date }): string {
  const year = new Date(contribution.createdAt).getFullYear()
  return `REC-${year}-${contribution.id.slice(-8).toUpperCase()}`
}

export async function generateReceiptHtml(contributionId: string): Promise<string> {
  const contribution = await prisma.contribution.findUnique({
    where: { id: contributionId },
    include: {
      membre: { include: { user: { select: { fullName: true, phone: true, memberId: true } } } },
      contributeurExterne: { select: { nom: true, phone: true } },
      rubrique: { select: { code: true, title: true } },
      collecteur: { select: { fullName: true } },
    },
  })

  if (!contribution) throw new Error('Contribution introuvable')

  const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } })
  const communityName = settings?.communityName ?? "Culte d'Enfants de Melen"
  const verse = settings?.communityVerse ?? 'La Marche Ensemble dans l\'Unité'
  const statutInfo = STATUT_LABELS[contribution.statut] ?? STATUT_LABELS.EN_ATTENTE_CONFIRMATION
  const hasCommission = !!(contribution.commissionPaidByPayer && contribution.commissionPaidByPayer > 0)
  const totalDebite = contribution.amountChargedToPayer ?? contribution.montant
  const logo = getLogoDataUri()
  const numero = invoiceNumber(contribution)

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Reçu ${numero}</title>
  <style>
    @page { size: A5; margin: 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #0F172A; background: #fff; font-size: 12.5px; line-height: 1.4; }

    .header { background: linear-gradient(135deg, #0F4A0F 0%, #1A6B1A 55%, #1A6B1A 100%); color: white; padding: 16px 18px; border-radius: 10px; margin-bottom: 14px; display: flex; align-items: center; gap: 12px; }
    .logo-box { width: 46px; height: 46px; background: white; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden; padding: 4px; }
    .logo-box img { width: 100%; height: 100%; object-fit: contain; }
    .header-text { flex: 1; min-width: 0; }
    .header-text h1 { font-size: 15px; font-weight: 700; letter-spacing: 0.2px; }
    .header-text p { font-size: 10px; opacity: 0.75; margin-top: 2px; }
    .header-meta { text-align: right; flex-shrink: 0; }
    .header-meta .num { font-family: "Courier New", monospace; font-size: 11px; font-weight: 700; }
    .header-meta .date { font-size: 9.5px; opacity: 0.75; margin-top: 2px; }

    .status-ribbon { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 7px; border-radius: 8px; font-size: 11.5px; font-weight: 800; letter-spacing: 0.4px; margin-bottom: 14px; }

    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
    .party { background: #F8FAFC; border: 1px solid #EEF2F6; border-radius: 8px; padding: 9px 11px; }
    .party .ptitle { font-size: 9px; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; margin-bottom: 4px; }
    .party .pname { font-size: 12.5px; font-weight: 700; color: #0F172A; }
    .party .pline { font-size: 10.5px; color: #64748B; margin-top: 1px; }

    table.items { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    table.items th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #94A3B8; padding: 0 8px 6px; border-bottom: 1.5px solid #E2E8F0; }
    table.items th.num, table.items td.num { text-align: right; }
    table.items td { padding: 8px; font-size: 12px; border-bottom: 1px solid #F1F5F9; }
    table.items td.desc strong { color: #0F172A; }
    table.items td.desc span { display: block; font-size: 10px; color: #94A3B8; }
    table.items td.num { font-family: "Courier New", monospace; font-weight: 700; color: #0F172A; white-space: nowrap; }
    table.items tr.commission td { color: #92400E; font-size: 11px; }
    table.items tr.commission td.num { color: #92400E; font-weight: 600; }

    .totals { margin-left: auto; width: 62%; margin-bottom: 16px; }
    .totals .row { display: flex; justify-content: space-between; padding: 4px 8px; font-size: 11.5px; }
    .totals .row.grand { border-top: 2px solid #1A6B1A; margin-top: 4px; padding-top: 8px; font-size: 15px; font-weight: 900; color: #0F4A0F; }
    .totals .row.grand .num { font-family: "Courier New", monospace; }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
    .field { background: #F8FAFC; border-radius: 8px; padding: 8px 10px; }
    .field .flabel { font-size: 9px; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .field .fval { font-size: 12px; font-weight: 600; color: #0F172A; word-break: break-word; }

    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 18px 0 14px; }
    .signatures .sig { text-align: center; }
    .signatures .sig .line { border-top: 1px solid #CBD5E1; margin-top: 26px; padding-top: 4px; font-size: 9.5px; color: #94A3B8; }

    .footer { border-top: 1px dashed #CBD5E1; padding-top: 10px; text-align: center; font-size: 9.5px; color: #94A3B8; }
    .footer strong { color: #0F4A0F; }
    .footer .verse { font-style: italic; margin-top: 4px; }
    .footer .meta { margin-top: 8px; font-size: 8.5px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-box">${logo ? `<img src="${logo}" alt="Logo" />` : ''}</div>
    <div class="header-text">
      <h1>Reçu de Contribution</h1>
      <p>${communityName} &bull; EEC Melen, Yaoundé</p>
    </div>
    <div class="header-meta">
      <div class="num">${numero}</div>
      <div class="date">${formatDate(contribution.createdAt)}</div>
    </div>
  </div>

  <div class="status-ribbon" style="background:${statutInfo.bg};color:${statutInfo.color};border:1.5px solid ${statutInfo.color}33;">
    ${contribution.statut === 'CONFIRME' ? '&#10003;' : contribution.statut === 'ANNULE' ? '&#10007;' : '&#8987;'} ${statutInfo.label}
  </div>

  <div class="parties">
    <div class="party">
      <div class="ptitle">Émis par</div>
      <div class="pname">${communityName}</div>
      <div class="pline">Système de Gestion du Ministère</div>
      <div class="pline">EEC Melen &bull; Yaoundé, Cameroun</div>
    </div>
    <div class="party">
      <div class="ptitle">Reçu de</div>
      <div class="pname">${contribution.membre?.user.fullName ?? contribution.contributeurExterne?.nom ?? 'Contributeur'}</div>
      <div class="pline">Matricule : ${contribution.membre?.memberId ?? 'Contributeur externe'}</div>
      ${(contribution.membre?.user.phone ?? contribution.contributeurExterne?.phone) ? `<div class="pline">${contribution.membre?.user.phone ?? contribution.contributeurExterne?.phone}</div>` : ''}
    </div>
  </div>

  <table class="items">
    <thead>
      <tr><th>Désignation</th><th class="num">Montant</th></tr>
    </thead>
    <tbody>
      <tr>
        <td class="desc">
          <strong>${contribution.rubrique?.code ?? '-'} &mdash; ${contribution.rubrique?.title ?? '-'}</strong>
          ${contribution.periodeLabel ? `<span>Période : ${contribution.periodeLabel}</span>` : ''}
        </td>
        <td class="num">${formatXAF(contribution.montant)}</td>
      </tr>
      ${hasCommission ? `
      <tr class="commission">
        <td class="desc">Frais de transaction Mobile Money (2,5&#37;, à charge du contributeur)</td>
        <td class="num">+ ${formatXAF(contribution.commissionPaidByPayer ?? 0)}</td>
      </tr>` : ''}
    </tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Montant net crédité à la rubrique</span><span class="num">${formatXAF(contribution.montant)}</span></div>
    ${hasCommission ? `<div class="row grand"><span>Total débité (Mobile Money)</span><span class="num">${formatXAF(totalDebite)}</span></div>`
      : `<div class="row grand"><span>Total payé</span><span class="num">${formatXAF(contribution.montant)}</span></div>`}
  </div>

  <div class="grid">
    <div class="field"><div class="flabel">Mode de paiement</div><div class="fval">${MODE_LABELS[contribution.modePaiement] ?? contribution.modePaiement}</div></div>
    <div class="field"><div class="flabel">Référence</div><div class="fval">${(contribution.referencePaiement ?? contribution.externalTransactionId ?? contribution.id).toString().slice(0, 24)}</div></div>
    <div class="field"><div class="flabel">Reçu par</div><div class="fval">${contribution.collecteur?.fullName ?? 'Système (paiement en ligne)'}</div></div>
    <div class="field"><div class="flabel">${contribution.confirmedAt ? 'Confirmé le' : 'Enregistré le'}</div><div class="fval">${formatDateTime(contribution.confirmedAt ?? contribution.createdAt)}</div></div>
  </div>

  ${contribution.modePaiement === 'ESPECES' ? `
  <div class="signatures">
    <div class="sig"><div class="line">Signature du collecteur</div></div>
    <div class="sig"><div class="line">Signature du contribuant</div></div>
  </div>` : ''}

  <div class="footer">
    <p>Document délivré par <strong>SGM-CEM</strong> &bull; ${communityName}</p>
    <p class="verse">"${verse.substring(0, 90)}"</p>
    <p class="meta">Reçu n&deg; ${numero} &bull; Généré le ${formatDateTime(new Date())} &bull; Ce document tient lieu de reçu de paiement — à conserver</p>
  </div>
</body>
</html>`
}

export async function generateReceiptPdf(contributionId: string): Promise<Buffer> {
  const html = await generateReceiptHtml(contributionId)
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({ format: 'A5', printBackground: true })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

/**
 * Génère le PDF, le stocke, et enregistre son URL sur la contribution.
 * Appelé automatiquement à chaque confirmation (webhooks, réconciliation, confirmations manuelles).
 */
export async function generateReceiptPDF(contributionId: string): Promise<string | null> {
  try {
    const pdf = await generateReceiptPdf(contributionId)
    const key = `receipts/${contributionId.substring(0, 8)}/${contributionId}.pdf`
    const { url } = await storeFile(key, pdf, 'application/pdf')

    const prisma = getPrisma()
    await prisma.contribution.update({
      where: { id: contributionId },
      data: { receiptUrl: url, receiptSentAt: new Date() },
    })

    return url
  } catch (e) {
    console.error('[Receipt] Erreur génération PDF:', e)
    return null
  }
}
