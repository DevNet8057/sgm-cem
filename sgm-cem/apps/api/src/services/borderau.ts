import puppeteer from 'puppeteer'
import { PrismaClient } from '@prisma/client'
import { storeFile } from './storage'
import { formatXAF, formatDate, formatDateTime, PDF_BASE_STYLES, renderDocHeader, renderDocFooter } from './pdf-branding'

const prisma = new PrismaClient()

const TRANSFER_TYPE_LABELS: Record<string, string> = {
  ESPECES_EN_MAIN: 'Remise en main propre (espèces)',
  DEPOT_MTN: 'Dépôt MTN MoMo',
  DEPOT_ORANGE: 'Dépôt Orange Money',
  AUTRE: 'Autre mode',
}

function borderauNumber(transfer: { id: string; createdAt: Date }): string {
  const year = new Date(transfer.createdAt).getFullYear()
  return `BRD-${year}-${transfer.id.slice(-8).toUpperCase()}`
}

export async function generateBorderauHtml(transferId: string): Promise<string> {
  const transfer = await prisma.fundsTransfer.findUnique({
    where: { id: transferId },
    include: {
      contributions: {
        include: {
          membre: { include: { user: { select: { fullName: true } } } },
          rubrique: { select: { code: true, title: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      sender: { select: { fullName: true, role: true, email: true } },
      receiver: { select: { fullName: true, role: true, email: true } },
    },
  })
  if (!transfer) throw new Error('Transfert introuvable')

  const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } })
  const communityName = settings?.communityName ?? "Culte d'Enfants de Melen"
  const verse = settings?.communityVerse ?? 'La Marche Ensemble dans l\'Unité'
  const numero = borderauNumber(transfer)
  const isConfirmed = transfer.status === 'CONFIRMED'

  const rows = transfer.contributions.map(c => `
    <tr>
      <td>${c.membre?.user.fullName ?? '-'}</td>
      <td><span class="code">${c.rubrique?.code ?? '-'}</span> ${c.rubrique?.title ?? ''}</td>
      <td class="num">${formatXAF(c.montant)}</td>
    </tr>`).join('')

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Bordereau ${numero}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    ${PDF_BASE_STYLES}
    body { font-size: 12.5px; line-height: 1.4; }
    .status-ribbon { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; border-radius: 8px; font-size: 12px; font-weight: 800; letter-spacing: 0.4px; margin-bottom: 16px; }
    .parties { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; margin-bottom: 16px; }
    .party { background: #F8FAFC; border: 1px solid #EEF2F6; border-radius: 8px; padding: 12px; }
    .party .ptitle { font-size: 9px; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; margin-bottom: 4px; }
    .party .pname { font-size: 14px; font-weight: 700; color: #0F172A; }
    .party .prole { font-size: 10.5px; color: #64748B; margin-top: 1px; }
    .arrow { font-size: 22px; color: #F5C400; text-align: center; }
    .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 18px; }
    .field { background: #F8FAFC; border-radius: 8px; padding: 8px 10px; }
    .field .flabel { font-size: 9px; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .field .fval { font-size: 12px; font-weight: 600; color: #0F172A; }
    table.items { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
    table.items th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.5px; color: #94A3B8; padding: 0 8px 6px; border-bottom: 1.5px solid #E2E8F0; }
    table.items th.num, table.items td.num { text-align: right; }
    table.items td { padding: 7px 8px; font-size: 12px; border-bottom: 1px solid #F1F5F9; }
    table.items td .code { font-family: "Courier New", monospace; font-size: 10.5px; color: #64748B; }
    table.items td.num { font-family: "Courier New", monospace; font-weight: 600; }
    .totals { margin-left: auto; width: 45%; margin-top: 10px; margin-bottom: 20px; }
    .totals .row.grand { border-top: 2px solid #1A6B1A; padding: 8px; font-size: 16px; font-weight: 900; color: #0F4A0F; display: flex; justify-content: space-between; }
    .totals .row.grand .num { font-family: "Courier New", monospace; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 28px 0 10px; }
    .signatures .sig { text-align: center; }
    .signatures .sig .line { border-top: 1px solid #CBD5E1; margin-top: 40px; padding-top: 4px; font-size: 10px; color: #94A3B8; }
    .signatures .sig .name { font-size: 11px; font-weight: 600; color: #0F172A; margin-top: 2px; }
  </style>
</head>
<body>
  ${renderDocHeader({
    title: 'Bordereau de Remise de Fonds',
    subtitle: `${communityName} · EEC Melen, Yaoundé`,
    docNumber: numero,
    date: formatDate(transfer.createdAt),
  })}

  <div class="status-ribbon" style="background:${isConfirmed ? '#E8F5E8' : '#FFFBEB'};color:${isConfirmed ? '#0F4A0F' : '#92400E'};border:1.5px solid ${isConfirmed ? '#0F4A0F33' : '#92400E33'};">
    ${isConfirmed ? '&#10003; TRANSFERT CONFIRMÉ' : transfer.status === 'REFUSED' ? '&#10007; TRANSFERT REFUSÉ' : '&#8987; EN ATTENTE DE VALIDATION'}
  </div>

  <div class="parties">
    <div class="party">
      <div class="ptitle">Remis par</div>
      <div class="pname">${transfer.senderName}</div>
      <div class="prole">${transfer.sender.role}</div>
    </div>
    <div class="arrow">&#8594;</div>
    <div class="party">
      <div class="ptitle">Reçu par</div>
      <div class="pname">${transfer.receiverName}</div>
      <div class="prole">${transfer.receiver.role}</div>
    </div>
  </div>

  <div class="grid">
    <div class="field"><div class="flabel">Mode de remise</div><div class="fval">${TRANSFER_TYPE_LABELS[transfer.transferType] ?? transfer.transferType}</div></div>
    <div class="field"><div class="flabel">Nombre de contributions</div><div class="fval">${transfer.contributions.length}</div></div>
    <div class="field"><div class="flabel">${isConfirmed ? 'Confirmé le' : 'Initié le'}</div><div class="fval">${formatDateTime(transfer.confirmedAt ?? transfer.createdAt)}</div></div>
  </div>

  <table class="items">
    <thead><tr><th>Membre</th><th>Rubrique</th><th class="num">Montant</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">Aucune contribution</td></tr>'}</tbody>
  </table>

  <div class="totals">
    <div class="row grand"><span>Total remis</span><span class="num">${formatXAF(transfer.totalAmount)}</span></div>
  </div>

  ${transfer.senderNote ? `<p style="font-size:11px;color:#64748B;margin-bottom:16px;"><strong>Note :</strong> ${transfer.senderNote}</p>` : ''}

  <div class="signatures">
    <div class="sig"><div class="line">Signature — ${transfer.senderName}</div></div>
    <div class="sig"><div class="line">Signature — ${transfer.receiverName}</div></div>
  </div>

  ${renderDocFooter({ communityName, verse, docNumber: numero })}
</body>
</html>`
}

export async function generateBorderauPdf(transferId: string): Promise<Buffer> {
  const html = await generateBorderauHtml(transferId)
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle0' })
  const pdf = await page.pdf({ format: 'A4', printBackground: true })
  await browser.close()
  return Buffer.from(pdf)
}

/** Génère le bordereau, le stocke, et enregistre son URL sur le transfert. */
export async function generateAndStoreBorderau(transferId: string): Promise<string | null> {
  try {
    const pdf = await generateBorderauPdf(transferId)
    const key = `borderaux/${transferId.substring(0, 8)}/${transferId}.pdf`
    const { url } = await storeFile(key, pdf, 'application/pdf')
    await prisma.fundsTransfer.update({ where: { id: transferId }, data: { borderauUrl: url } })
    return url
  } catch (e) {
    console.error('[Borderau] Erreur génération PDF:', e)
    return null
  }
}
