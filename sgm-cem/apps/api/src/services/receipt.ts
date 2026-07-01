import puppeteer from 'puppeteer'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function formatXAF(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(amount)
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const MODE_LABELS: Record<string, string> = {
  ESPECES: 'Especes', MTN_MOMO: 'MTN MoMo', ORANGE_MONEY: 'Orange Money',
  CARTE_VISA: 'Carte Visa', VIREMENT: 'Virement',
}

export async function generateReceiptHtml(contributionId: string): Promise<string> {
  const contribution = await prisma.contribution.findUnique({
    where: { id: contributionId },
    include: {
      membre: { include: { user: { select: { fullName: true, memberId: true } } } },
      rubrique: { select: { code: true, title: true } },
      collecteur: { select: { fullName: true } },
    },
  })

  if (!contribution) throw new Error('Contribution introuvable')

  const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } })

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Recu SGM-CEM</title>
  <style>
    @page { size: A5; margin: 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #0F172A; background: #fff; font-size: 13px; }
    .header { background: linear-gradient(135deg, #0F4A0F, #1A6B1A); color: white; padding: 16px 20px; border-radius: 8px; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
    .logo { width: 44px; height: 44px; background: #F5C400; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 14px; color: #0F4A0F; flex-shrink: 0; }
    .header-text h1 { font-size: 18px; font-weight: 700; }
    .header-text p { font-size: 11px; opacity: 0.7; margin-top: 2px; }
    .badge { display: inline-block; background: #E8F5E8; color: #1A6B1A; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; margin-bottom: 16px; border: 1.5px solid #1A6B1A; }
    .amount-block { text-align: center; border: 2px solid #1A6B1A; border-radius: 10px; padding: 14px; margin-bottom: 16px; }
    .amount-block .label { font-size: 11px; color: #64748B; text-transform: uppercase; letter-spacing: 1px; }
    .amount-block .amount { font-size: 28px; font-weight: 900; color: #0F4A0F; margin-top: 4px; font-family: "Courier New", monospace; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
    .field { background: #F8FAFC; border-radius: 8px; padding: 10px; }
    .field .flabel { font-size: 10px; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
    .field .fval { font-size: 13px; font-weight: 600; color: #0F172A; }
    .footer { border-top: 1px dashed #CBD5E1; padding-top: 12px; text-align: center; font-size: 10px; color: #94A3B8; }
    .footer strong { color: #0F4A0F; }
    .ref { font-family: monospace; font-size: 11px; color: #64748B; background: #F1F5F9; padding: 6px 10px; border-radius: 6px; margin-bottom: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">CEM</div>
    <div class="header-text">
      <h1>Recu de Contribution</h1>
      <p>${settings?.communityName ?? "Culte d'Enfants de Melen"} &bull; EEC Yaounde</p>
    </div>
  </div>

  <div class="badge">&#10003; Paiement ${contribution.statut === 'CONFIRME' ? 'CONFIRME' : 'ENREGISTRE'}</div>

  <div class="amount-block">
    <div class="label">Montant regle</div>
    <div class="amount">${formatXAF(contribution.montant)}</div>
  </div>

  <div class="ref">Ref: ${contribution.id.substring(0, 12).toUpperCase()}</div>

  <div class="grid">
    <div class="field"><div class="flabel">Membre</div><div class="fval">${contribution.membre?.user.fullName ?? '-'}</div></div>
    <div class="field"><div class="flabel">Matricule</div><div class="fval">${contribution.membre?.memberId ?? '-'}</div></div>
    <div class="field"><div class="flabel">Rubrique</div><div class="fval">${contribution.rubrique?.code} &mdash; ${contribution.rubrique?.title}</div></div>
    <div class="field"><div class="flabel">Mode</div><div class="fval">${MODE_LABELS[contribution.modePaiement] ?? contribution.modePaiement}</div></div>
    ${contribution.periodeLabel ? `<div class="field"><div class="flabel">Periode</div><div class="fval">${contribution.periodeLabel}</div></div>` : ''}
    <div class="field"><div class="flabel">Collecteur</div><div class="fval">${contribution.collecteur?.fullName ?? '-'}</div></div>
    <div class="field"><div class="flabel">Date</div><div class="fval">${formatDate(contribution.createdAt)}</div></div>
    ${contribution.confirmedAt ? `<div class="field"><div class="flabel">Confirme le</div><div class="fval">${formatDate(contribution.confirmedAt)}</div></div>` : ''}
  </div>

  <div class="footer">
    <p>Ce recu est delivre par <strong>SGM-CEM</strong> &bull; ${settings?.communityName ?? "CEM Melen"}</p>
    <p style="margin-top:4px;">"${settings?.communityVerse?.substring(0, 80) ?? 'La Marche Ensemble dans l Unite'}"</p>
    <p style="margin-top:8px;font-size:9px;">Document genere le ${formatDate(new Date())} &bull; A conserver</p>
  </div>
</body>
</html>`
}

export async function generateReceiptPdf(contributionId: string): Promise<Buffer> {
  const html = await generateReceiptHtml(contributionId)
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle0' })
  const pdf = await page.pdf({ format: 'A5', printBackground: true })
  await browser.close()
  return Buffer.from(pdf)
}
