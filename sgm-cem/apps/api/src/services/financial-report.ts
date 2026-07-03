import puppeteer from 'puppeteer'
import { PrismaClient } from '@prisma/client'
import { computeDashboardStats } from '../routes/stats'
import { formatXAF, formatDateTime, getLogoDataUri, renderDocFooter } from './pdf-branding'

const prisma = new PrismaClient()

const MODE_LABELS: Record<string, string> = {
  ESPECES: 'Espèces', MTN_MOMO: 'MTN MoMo', ORANGE_MONEY: 'Orange Money',
  YELII: 'Mobile Money (Yelii)', CARTE_VISA: 'Carte bancaire', VIREMENT: 'Virement bancaire',
}

const MODE_COLORS: Record<string, string> = {
  ESPECES: '#1A6B1A', MTN_MOMO: '#F5C400', ORANGE_MONEY: '#FF6600',
  YELII: '#7C3AED', CARTE_VISA: '#2563EB', VIREMENT: '#0F4A0F',
}

export async function generateFinancialReportHtml(year?: number): Promise<string> {
  const stats = await computeDashboardStats(year)
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } })
  const communityName = settings?.communityName ?? "Culte d'Enfants de Melen"
  const verse = settings?.communityVerse ?? 'La Marche Ensemble dans l\'Unité'
  const numero = `RAP-${stats.year}`
  const logo = getLogoDataUri()
  const maxRate = Math.max(...stats.contributionRates.map(r => r.rate ?? 0), 1)

  const paymentBars = stats.modePaiementStats.map(item => {
    const color = MODE_COLORS[item.modePaiement] ?? '#64748B'
    return `
    <div class="bar-row">
      <div class="bar-label">${MODE_LABELS[item.modePaiement] ?? item.modePaiement}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${item.share}%;background:${color};"></div></div>
      <div class="bar-value">${item.share}%</div>
      <div class="bar-amount">${formatXAF(item.total)}</div>
    </div>`
  }).join('')

  const topRows = stats.topContributors.map((item, i) => `
    <tr>
      <td class="rank rank-${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'plain'}">${i + 1}</td>
      <td><strong>${item.fullName}</strong></td>
      <td class="num">${item.count}</td>
      <td class="num strong">${formatXAF(item.total)}</td>
    </tr>`).join('')

  const rateRows = stats.contributionRates.map(item => {
    const rate = item.rate ?? 0
    const pct = item.rate == null ? 0 : Math.min(100, Math.round((rate / maxRate) * 100))
    return `
    <tr>
      <td><span class="code">${item.code}</span><br/>${item.title}</td>
      <td class="num">${formatXAF(item.total)}</td>
      <td class="rate-cell">
        ${item.rate == null
          ? '<span class="free-badge">Sans objectif</span>'
          : `<div class="mini-track"><div class="mini-fill" style="width:${pct}%;"></div></div><span class="rate-label">${item.rate}%</span>`}
      </td>
    </tr>`
  }).join('')

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Rapport financier ${stats.year}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", Arial, sans-serif; color: #0F172A; font-size: 11.5px; line-height: 1.45;
      background-image: url("data:image/svg+xml,%3Csvg width='32' height='32' viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M14 0h4v14h14v4H18v14h-4V18H0v-4h14z' fill='%23F5C400' fill-opacity='0.05'/%3E%3C/svg%3E");
    }
    .page { padding: 14mm 14mm 10mm; }

    /* ── Cover band ── */
    .cover {
      background: linear-gradient(135deg, #052005 0%, #0F4A0F 45%, #1A6B1A 100%);
      color: white; padding: 22px 26px; display: flex; align-items: center; gap: 18px;
      position: relative; overflow: hidden;
    }
    .cover::after {
      content: ''; position: absolute; top: -40px; right: -40px; width: 160px; height: 160px;
      border-radius: 999px; background: radial-gradient(circle, rgba(245,196,0,0.18), transparent 70%);
    }
    .cover .logo-box { width: 58px; height: 58px; background: white; border-radius: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 6px; box-shadow: 0 4px 14px rgba(0,0,0,0.25); }
    .cover .logo-box img { width: 100%; height: 100%; object-fit: contain; }
    .cover .ctext { flex: 1; position: relative; z-index: 1; }
    .cover .ctext .eyebrow { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: #F5C400; font-weight: 700; }
    .cover .ctext h1 { font-size: 24px; font-weight: 800; margin-top: 4px; }
    .cover .ctext p { font-size: 11px; opacity: 0.75; margin-top: 3px; }
    .cover .cmeta { text-align: right; position: relative; z-index: 1; flex-shrink: 0; }
    .cover .cmeta .num { font-family: "Courier New", monospace; font-size: 13px; font-weight: 700; color: #F5C400; }
    .cover .cmeta .date { font-size: 9.5px; opacity: 0.7; margin-top: 3px; }

    .body-content { padding: 20px 14mm 0; }

    /* ── KPI cards ── */
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
    .kpi { border: 1px solid #E2E8F0; border-radius: 12px; padding: 13px; background: white; box-shadow: 0 1px 3px rgba(15,74,15,0.05); position: relative; overflow: hidden; }
    .kpi::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: #1A6B1A; }
    .kpi.gold::before { background: #F5C400; }
    .kpi span { display: block; font-size: 9px; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; padding-left: 6px; }
    .kpi strong { display: block; font-size: 19px; color: #0F4A0F; margin-top: 6px; font-family: "Courier New", monospace; padding-left: 6px; }

    /* ── Section ── */
    .section { margin-bottom: 18px; background: white; border-radius: 12px; border: 1px solid #EEF2F6; box-shadow: 0 1px 3px rgba(15,74,15,0.04); overflow: hidden; }
    .section-head { display: flex; align-items: center; gap: 8px; padding: 11px 16px; background: linear-gradient(135deg, #0F4A0F, #1A6B1A); }
    .section-head .dot { width: 7px; height: 7px; border-radius: 999px; background: #F5C400; }
    .section-head h2 { color: white; font-size: 12.5px; font-weight: 700; letter-spacing: 0.3px; }
    .section-body { padding: 14px 16px; }

    .callout { background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 10px; padding: 11px 15px; font-size: 11px; color: #78350F; margin-bottom: 16px; line-height: 1.6; }
    .callout strong { color: #92400E; }

    /* ── Bar chart (payment modes) ── */
    .bar-row { display: grid; grid-template-columns: 110px 1fr 40px 90px; align-items: center; gap: 10px; padding: 6px 0; }
    .bar-label { font-size: 10.5px; font-weight: 600; color: #334155; }
    .bar-track { height: 10px; background: #F1F5F9; border-radius: 999px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 999px; }
    .bar-value { font-size: 10.5px; font-weight: 700; color: #0F4A0F; text-align: right; }
    .bar-amount { font-size: 10px; font-family: "Courier New", monospace; color: #64748B; text-align: right; }

    /* ── Tables ── */
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { text-align: left; color: #94A3B8; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; padding: 0 9px 8px; border-bottom: 1.5px solid #E2E8F0; }
    th.num, td.num { text-align: right; }
    td { padding: 8px 9px; border-bottom: 1px solid #F1F5F9; vertical-align: middle; }
    td.num { font-family: "Courier New", monospace; }
    td.num.strong { font-weight: 700; color: #0F4A0F; }
    td .code { font-family: "Courier New", monospace; color: #64748B; font-size: 9.5px; }
    td.rank { text-align: center; font-weight: 800; width: 26px; border-radius: 999px; }
    .rank-gold { color: #92400E; } .rank-gold::before { content: '🥇'; }
    .rank-silver::before { content: '🥈'; }
    .rank-bronze::before { content: '🥉'; }
    .rank-plain { color: #94A3B8; }
    .rate-cell { display: flex; align-items: center; gap: 8px; min-width: 140px; }
    .mini-track { flex: 1; height: 7px; background: #F1F5F9; border-radius: 999px; overflow: hidden; }
    .mini-fill { height: 100%; background: linear-gradient(90deg, #1A6B1A, #F5C400); border-radius: 999px; }
    .rate-label { font-size: 10px; font-weight: 700; color: #0F4A0F; width: 40px; text-align: right; }
    .free-badge { font-size: 9.5px; color: #94A3B8; font-style: italic; }

    .footer-wrap { padding: 0 14mm 12mm; }
  </style>
</head>
<body>
  <div class="cover">
    <div class="logo-box">${logo ? `<img src="${logo}" alt="Logo" />` : ''}</div>
    <div class="ctext">
      <div class="eyebrow">Document officiel</div>
      <h1>Rapport Financier Annuel</h1>
      <p>${communityName} &bull; EEC Melen, Yaoundé &bull; Exercice ${stats.year}</p>
    </div>
    <div class="cmeta">
      <div class="num">${numero}</div>
      <div class="date">${formatDateTime(new Date())}</div>
    </div>
  </div>

  <div class="body-content">
    <div class="kpis">
      <div class="kpi"><span>Membres actifs</span><strong>${stats.totalMembres}</strong></div>
      <div class="kpi gold"><span>Collecte annuelle</span><strong>${formatXAF(stats.totalCollectedYear)}</strong></div>
      <div class="kpi"><span>Collecte du mois</span><strong>${formatXAF(stats.totalCollectedMonth)}</strong></div>
      <div class="kpi"><span>Taux de confirmation</span><strong>${stats.globalConfirmationRate}%</strong></div>
    </div>

    <div class="callout">
      Le moyen de contribution le plus utilisé est <strong>${stats.mostUsedPaymentMode ? (MODE_LABELS[stats.mostUsedPaymentMode.modePaiement] ?? stats.mostUsedPaymentMode.modePaiement) : '—'}</strong>.
      Le plus grand contributeur de l'exercice est <strong>${stats.topContributor?.fullName ?? '—'}</strong> avec <strong>${formatXAF(stats.topContributor?.total ?? 0)}</strong> versés.
      ${stats.litiges > 0 ? ` <strong>${stats.litiges} contribution(s)</strong> sont actuellement en litige et méritent une attention.` : ' Aucun litige en cours — la trésorerie est saine.'}
    </div>

    <div class="section">
      <div class="section-head"><span class="dot"></span><h2>Moyens de contribution</h2></div>
      <div class="section-body">
        ${paymentBars || '<p style="color:#94A3B8;">Aucune donnée</p>'}
      </div>
    </div>

    <div class="section">
      <div class="section-head"><span class="dot"></span><h2>Top contributeurs</h2></div>
      <div class="section-body">
        <table>
          <thead><tr><th>#</th><th>Membre</th><th class="num">Contributions</th><th class="num">Total versé</th></tr></thead>
          <tbody>${topRows || '<tr><td colspan="4">Aucune donnée</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><span class="dot"></span><h2>Taux de collecte par rubrique</h2></div>
      <div class="section-body">
        <table>
          <thead><tr><th>Rubrique</th><th class="num">Collecte</th><th>Progression</th></tr></thead>
          <tbody>${rateRows || '<tr><td colspan="3">Aucune donnée</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="footer-wrap">
    ${renderDocFooter({ communityName, verse, docNumber: numero })}
  </div>
</body>
</html>`
}

export async function generateFinancialReportPdf(year?: number): Promise<Buffer> {
  const html = await generateFinancialReportHtml(year)
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle0' })
  const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0mm', bottom: '10mm', left: '0mm', right: '0mm' } })
  await browser.close()
  return Buffer.from(pdf)
}
