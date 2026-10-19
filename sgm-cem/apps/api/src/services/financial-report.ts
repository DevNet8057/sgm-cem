// Rapport financier (année ou mois, heure de Yaoundé) présentable au Bureau :
// synthèse, flux mensuels, rubriques, moyens de paiement, position des fonds en
// fin de période (grand livre), dépôts en banque, remboursements, prestations,
// clôtures, signatures. Gabarit commun des documents.
import { renderPdf } from './pdf-render'
import { getPrisma } from '../lib/prisma'
import { positionAt } from './fund-ledger.service'
import { MOIS, monthBounds } from './closure.service'
import { MODE_LABELS } from './receipt'
import { e, formatDate, loadIdentity, money, pdfOptions, renderDocument } from './documents/document-kit'

const prisma = getPrisma()

export interface ReportPeriod { year: number; month?: number }

const LOCATION_LABELS: Record<string, string> = {
  CHEZ_COLLECTEUR: 'Chez les collecteurs', EN_TRANSIT: 'En transit', CHEZ_RESPONSABLE: 'Chez les responsables',
  REMIS_TRESORIER: 'Remis au trésorier', EN_CAISSE: 'En caisse', EN_BANQUE: 'En banque', PORTEFEUILLE_ELECTRONIQUE: 'Portefeuille électronique',
}
const REFUND_MEANS: Record<string, string> = { ESPECES: 'Espèces', MOBILE_MONEY: 'Mobile Money', VIREMENT: 'Virement' }
const CLOSURE_LABELS: Record<string, string> = { PRESENTEE: 'Présentée', VALIDEE: 'Visée', REJETEE: 'Refusée' }

export function reportNumber(p: ReportPeriod): string {
  return p.month ? `RAP-${p.year}-${String(p.month).padStart(2, '0')}` : `RAP-${p.year}`
}

function bounds(p: ReportPeriod): { start: Date; end: Date } {
  if (p.month) return monthBounds(p.year, p.month)
  return { start: monthBounds(p.year, 1).start, end: monthBounds(p.year, 12).end }
}

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0)
const fmtPct = (v: number) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`

/** Histogramme des encaissements nets par mois (SVG intégré, aucune ressource extérieure). */
function monthlyChart(rows: Array<{ label: string; net: number }>): string {
  const W = 640, H = 150, pad = 22, bw = (W - pad * 2) / rows.length
  const max = Math.max(1, ...rows.map(r => r.net))
  const bars = rows.map((r, i) => {
    const h = Math.max(0, (r.net / max) * (H - 40))
    const x = pad + i * bw + bw * 0.18
    return `<rect x="${x.toFixed(1)}" y="${(H - 20 - h).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="#1A6B1A"/>
      <text x="${(pad + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" font-size="9" text-anchor="middle" fill="#5B6B62">${e(r.label)}</text>
      ${r.net > 0 ? `<text x="${(pad + i * bw + bw / 2).toFixed(1)}" y="${(H - 24 - h).toFixed(1)}" font-size="7.5" text-anchor="middle" fill="#14201A">${Math.round(r.net / 1000).toLocaleString('fr-FR')} k</text>` : ''}`
  }).join('')
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Encaissements nets par mois">
    <line x1="${pad}" y1="${H - 20}" x2="${W - pad}" y2="${H - 20}" stroke="#DDE5DF"/>${bars}</svg>`
}

export async function generateFinancialReportHtml(period: ReportPeriod): Promise<string> {
  const { start, end } = bounds(period)
  const inPeriod = { gte: start, lte: end }
  const label = period.month ? `${MOIS[period.month - 1]} ${period.year}` : `exercice ${period.year}`

  const [identity, confirmed, pendingAgg, disputedAgg, byMode, byRubrique, refunds, deposits, prestEntrees, prestCours, closures, position, rubriques, contributeurs] = await Promise.all([
    loadIdentity(),
    prisma.contribution.aggregate({ where: { statut: 'CONFIRME', createdAt: inPeriod }, _sum: { montant: true }, _count: true }),
    prisma.contribution.aggregate({ where: { statut: 'EN_ATTENTE_CONFIRMATION', createdAt: inPeriod }, _sum: { montant: true }, _count: true }),
    prisma.contribution.aggregate({ where: { statut: 'LITIGE', createdAt: inPeriod }, _sum: { montant: true }, _count: true }),
    prisma.contribution.groupBy({ by: ['modePaiement'], where: { statut: 'CONFIRME', createdAt: inPeriod }, _sum: { montant: true }, _count: true }),
    prisma.contribution.groupBy({ by: ['rubriqueId'], where: { statut: 'CONFIRME', createdAt: inPeriod }, _sum: { montant: true }, _count: true }),
    prisma.remboursement.findMany({
      where: { statut: 'EXECUTE', executedAt: inPeriod },
      select: { montant: true, moyen: true, executedAt: true, rubriqueId: true, motif: true, contribution: { select: { membre: { select: { user: { select: { fullName: true } } } }, contributeurExterne: { select: { nom: true } } } } },
      orderBy: { executedAt: 'asc' },
    }),
    prisma.bankDeposit.findMany({ where: { createdAt: inPeriod }, select: { referenceBordereau: true, dateBordereau: true, createdAt: true, totalAmount: true, depositedByName: true }, orderBy: { createdAt: 'asc' } }),
    prisma.entreePrestation.aggregate({ where: { createdAt: inPeriod }, _sum: { montant: true }, _count: true }),
    prisma.coursPrestation.aggregate({ where: { createdAt: inPeriod }, _sum: { montant: true }, _count: true }),
    prisma.clotureMensuelle.findMany({ where: { OR: Array.from({ length: period.month ? 1 : 12 }, (_, i) => ({ annee: period.year, mois: period.month ?? i + 1 })) }, orderBy: { mois: 'asc' } }),
    positionAt(prisma, end),
    prisma.rubrique.findMany({ select: { id: true, code: true, title: true, targetAmount: true, status: true, fiscalYear: true } }),
    prisma.contribution.findMany({ where: { statut: 'CONFIRME', createdAt: inPeriod }, select: { membreId: true, contributeurExterneId: true }, distinct: ['membreId', 'contributeurExterneId'] }),
  ])

  const encaisse = confirmed._sum.montant ?? 0
  const rembourse = refunds.reduce((s, r) => s + r.montant, 0)
  const net = encaisse - rembourse
  const pendingAmount = pendingAgg._sum.montant ?? 0
  const disputedAmount = disputedAgg._sum.montant ?? 0
  const totalCount = confirmed._count + pendingAgg._count + disputedAgg._count
  const prestRecettes = prestEntrees._sum.montant ?? 0
  const prestDepenses = prestCours._sum.montant ?? 0

  // Flux mensuels (exercice) ou journée par journée n'apporte rien sur un mois : un seul tableau de synthèse
  let monthlySection = ''
  if (!period.month) {
    const months = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
      const b = monthBounds(period.year, i + 1)
      const [c, r] = await Promise.all([
        prisma.contribution.aggregate({ where: { statut: 'CONFIRME', createdAt: { gte: b.start, lte: b.end } }, _sum: { montant: true }, _count: true }),
        prisma.remboursement.aggregate({ where: { statut: 'EXECUTE', executedAt: { gte: b.start, lte: b.end } }, _sum: { montant: true } }),
      ])
      const enc = c._sum.montant ?? 0
      const rem = r._sum.montant ?? 0
      return { label: MOIS_COURTS[i], name: MOIS[i], count: c._count, enc, rem, net: enc - rem }
    }))
    monthlySection = `
    <section class="flow">
      <h2>Évolution mensuelle</h2>
      ${monthlyChart(months)}
      <table style="margin-top:6px">
        <thead><tr><th>Mois</th><th class="num">Contributions</th><th class="num">Encaissé</th><th class="num">Remboursé</th><th class="num">Net</th></tr></thead>
        <tbody>${months.map(m => `<tr${m.count === 0 && m.rem === 0 ? ' class="muted"' : ''}><td>${e(m.name)}</td><td class="num">${m.count}</td><td class="num">${money(m.enc)}</td><td class="num">${m.rem ? money(m.rem) : '—'}</td><td class="num">${money(m.net)}</td></tr>`).join('')}
          <tr class="total"><td>Total</td><td class="num">${confirmed._count}</td><td class="num">${money(encaisse)}</td><td class="num">${money(rembourse)}</td><td class="num">${money(net)}</td></tr></tbody>
      </table>
    </section>`
  }

  // Rubriques : toutes celles qui ont bougé dans la période, plus les rubriques ouvertes
  const refundByRubrique = new Map<string, number>()
  for (const r of refunds) refundByRubrique.set(r.rubriqueId, (refundByRubrique.get(r.rubriqueId) ?? 0) + r.montant)
  const encByRubrique = new Map(byRubrique.map(r => [r.rubriqueId, { amount: r._sum.montant ?? 0, count: r._count }]))
  const rubRows = rubriques
    .filter(r => encByRubrique.has(r.id) || refundByRubrique.has(r.id) || r.status === 'OUVERTE')
    .map(r => {
      const enc = encByRubrique.get(r.id)?.amount ?? 0
      const rem = refundByRubrique.get(r.id) ?? 0
      return { ...r, enc, rem, net: enc - rem, count: encByRubrique.get(r.id)?.count ?? 0 }
    })
    .sort((a, b) => b.net - a.net)

  const modeRows = byMode.map(m => ({ mode: m.modePaiement, amount: m._sum.montant ?? 0, count: m._count })).sort((a, b) => b.amount - a.amount)

  const body = `
  <section>
    <div class="kpis">
      <div class="kpi"><div class="k">Encaissé</div><div class="v">${money(encaisse)}</div><div class="s">${confirmed._count} contribution(s) confirmée(s)</div></div>
      <div class="kpi"><div class="k">Remboursé</div><div class="v">${money(rembourse)}</div><div class="s">${refunds.length} remboursement(s)</div></div>
      <div class="kpi gold"><div class="k">Net de la période</div><div class="v">${money(net)}</div><div class="s">${contributeurs.length} contributeur(s)</div></div>
      <div class="kpi"><div class="k">Fonds disponibles</div><div class="v">${position.beforeLedgerStart ? '—' : money(position.total)}</div><div class="s">${position.beforeLedgerStart ? 'non reconstituable à cette date' : `au ${formatDate(end)}`}</div></div>
    </div>
    <div class="kv" style="margin-top:10px">
      <div><span>En attente de confirmation</span><span>${money(pendingAmount)} · ${pendingAgg._count}</span></div>
      <div><span>En litige</span><span>${money(disputedAmount)} · ${disputedAgg._count}</span></div>
      <div><span>Taux de confirmation</span><span>${fmtPct(pct(confirmed._count, totalCount))}</span></div>
      <div><span>Panier moyen</span><span>${money(confirmed._count ? Math.round(encaisse / confirmed._count) : 0)}</span></div>
    </div>
  </section>
  ${monthlySection}
  <section class="flow">
    <h2>Rubriques</h2>
    <table>
      <thead><tr><th>Rubrique</th><th class="num">Nb</th><th class="num">Encaissé</th><th class="num">Remboursé</th><th class="num">Net</th><th class="num">Objectif</th><th class="num">Atteint</th></tr></thead>
      <tbody>${rubRows.map(r => `<tr><td>${e(r.title)}<span class="sub">${e(r.code)} · ${r.status === 'OUVERTE' ? 'ouverte' : r.status === 'FERMEE' ? 'fermée' : 'archivée'}</span></td>
        <td class="num">${r.count}</td><td class="num">${money(r.enc)}</td><td class="num">${r.rem ? money(r.rem) : '—'}</td><td class="num">${money(r.net)}</td>
        <td class="num">${r.targetAmount ? money(r.targetAmount) : '—'}</td><td class="num">${r.targetAmount ? fmtPct(pct(r.net, r.targetAmount)) : '—'}</td></tr>`).join('') || '<tr><td colspan="7">Aucune rubrique</td></tr>'}
        <tr class="total"><td>Total</td><td class="num">${confirmed._count}</td><td class="num">${money(encaisse)}</td><td class="num">${money(rembourse)}</td><td class="num">${money(net)}</td><td></td><td></td></tr></tbody>
    </table>
  </section>
  <section>
    <h2>Moyens de paiement</h2>
    <table>
      <thead><tr><th>Moyen</th><th class="num">Nb</th><th class="num">Montant</th><th style="width:34%">Part du montant</th></tr></thead>
      <tbody>${modeRows.map(m => `<tr><td>${e(MODE_LABELS[m.mode] ?? m.mode)}</td><td class="num">${m.count}</td><td class="num">${money(m.amount)}</td>
        <td><div style="display:flex;align-items:center;gap:6px"><div class="bar" style="flex:1"><span style="width:${pct(m.amount, encaisse)}%"></span></div><span class="num" style="width:44px">${fmtPct(pct(m.amount, encaisse))}</span></div></td></tr>`).join('') || '<tr><td colspan="4">Aucun encaissement</td></tr>'}</tbody>
    </table>
  </section>
  <section>
    <h2>Position des fonds au ${formatDate(end)}</h2>
    ${position.beforeLedgerStart ? '<div class="note">Date antérieure à la mise en service du grand livre : position non reconstituable.</div>' : `
    <table>
      <thead><tr><th>Emplacement</th><th class="num">Contributions</th><th class="num">Montant</th><th class="num">Part</th></tr></thead>
      <tbody>${position.byLocation.filter(r => r.amount !== 0).map(r => `<tr><td>${e(LOCATION_LABELS[r.location] ?? r.location)}</td><td class="num">${r.count}</td><td class="num">${money(r.amount)}</td><td class="num">${fmtPct(pct(r.amount, position.total))}</td></tr>`).join('')}
        <tr class="total"><td>Total des fonds</td><td></td><td class="num">${money(position.total)}</td><td class="num">100 %</td></tr></tbody>
    </table>`}
  </section>
  <section class="flow">
    <h2>Dépôts en banque</h2>
    <table>
      <thead><tr><th>Date</th><th>Bordereau</th><th>Déposé par</th><th class="num">Montant</th></tr></thead>
      <tbody>${deposits.map(d => `<tr><td>${formatDate(d.dateBordereau ?? d.createdAt)}</td><td>${e(d.referenceBordereau)}</td><td>${e(d.depositedByName)}</td><td class="num">${money(d.totalAmount)}</td></tr>`).join('') || '<tr class="muted"><td colspan="4">Aucun dépôt sur la période</td></tr>'}
        ${deposits.length ? `<tr class="total"><td colspan="3">Total déposé</td><td class="num">${money(deposits.reduce((s, d) => s + d.totalAmount, 0))}</td></tr>` : ''}</tbody>
    </table>
  </section>
  <section class="flow">
    <h2>Remboursements exécutés</h2>
    <table>
      <thead><tr><th>Date</th><th>Bénéficiaire</th><th>Motif</th><th>Moyen</th><th class="num">Montant</th></tr></thead>
      <tbody>${refunds.map(r => `<tr><td>${formatDate(r.executedAt!)}</td><td>${e(r.contribution.membre?.user.fullName ?? r.contribution.contributeurExterne?.nom ?? '—')}</td><td>${e(r.motif.slice(0, 70))}</td><td>${e(REFUND_MEANS[r.moyen] ?? r.moyen)}</td><td class="num">${money(r.montant)}</td></tr>`).join('') || '<tr class="muted"><td colspan="5">Aucun remboursement sur la période</td></tr>'}</tbody>
    </table>
  </section>
  <section>
    <h2>Prestations</h2>
    <div class="kv three">
      <div><span>Recettes</span><span>${money(prestRecettes)}</span></div>
      <div><span>Dépenses</span><span>${money(prestDepenses)}</span></div>
      <div><span>Résultat</span><span>${money(prestRecettes - prestDepenses)}</span></div>
    </div>
    <p class="lead" style="font-size:8.6pt">Les prestations sont suivies à part : leur argent n'entre pas encore dans la position des fonds (décision du Bureau du 18/10/2026).</p>
  </section>
  <section>
    <h2>Clôtures mensuelles</h2>
    <table>
      <thead><tr><th>Mois</th><th>État</th><th>Visée par</th><th class="num">Écart caisse</th><th class="num">Écart banque</th></tr></thead>
      <tbody>${closures.map(c => `<tr><td>${e(MOIS[c.mois - 1])} ${c.annee}</td><td>${e(CLOSURE_LABELS[c.statut] ?? c.statut)}</td><td>${e(c.validatedByName ?? '—')}</td><td class="num">${money(c.caisseComptee - c.attenduCaisse)}</td><td class="num">${money(c.soldeBancaire - c.attenduBanque)}</td></tr>`).join('') || '<tr class="muted"><td colspan="5">Aucune clôture présentée sur la période</td></tr>'}</tbody>
    </table>
  </section>`

  return renderDocument({
    identity, kind: 'Rapport financier', docNumber: reportNumber(period), issuedAt: new Date(),
    lead: `Période : <strong>${e(label)}</strong>, du ${formatDate(start)} au ${formatDate(end)} (heure de Yaoundé). Montants en francs CFA ; encaissements confirmés, nets des remboursements exécutés.`,
    body,
    signatures: [{ role: 'Le trésorier' }, { role: 'Le président' }],
    closingNote: 'Rapport établi à partir des écritures enregistrées dans SGM-CEM',
  })
}

export async function generateFinancialReportPdf(period: ReportPeriod): Promise<Buffer> {
  const html = await generateFinancialReportHtml(period)
  return renderPdf(html, pdfOptions('A4', await loadIdentity(), reportNumber(period)))
}
