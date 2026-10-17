// PDF de clôture mensuelle (lot 4.2) : produit depuis l'instantané enregistré,
// donc identique à chaque téléchargement ; porte le présentateur et le viseur.
import type { ClotureMensuelle } from '@prisma/client'
import { renderPdf } from './pdf-render'
import { escapeHtml as e, formatDateTime, formatXAF, getLogoDataUri, renderDocFooter } from './pdf-branding'
import { MOIS } from './closure.service'
import { getPrisma } from '../lib/prisma'

const prisma = getPrisma()

const LOCATION_LABELS: Record<string, string> = {
  CHEZ_COLLECTEUR: 'Chez les collecteurs', EN_TRANSIT: 'En transit', CHEZ_RESPONSABLE: 'Chez les responsables',
  REMIS_TRESORIER: 'Remis au trésorier', EN_CAISSE: 'En caisse', EN_BANQUE: 'En banque', PORTEFEUILLE_ELECTRONIQUE: 'Portefeuille électronique',
}

const STATUT_LABELS = { PRESENTEE: 'Présentée — en attente de visa', VALIDEE: 'Visée — mois clos', REJETEE: 'Refusée' } as const

export async function renderClosurePdf(c: ClotureMensuelle): Promise<Buffer> {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } })
  const communityName = settings?.communityName ?? "Culte d'Enfants de Melen"
  const verse = settings?.communityVerse ?? ''
  const libelle = `${MOIS[c.mois - 1]} ${c.annee}`
  const docNumber = `CLO-${c.annee}-${String(c.mois).padStart(2, '0')}`
  const position = c.positionFin as unknown as { byLocation: Array<{ location: string; amount: number; count: number }>; total: number; beforeLedgerStart?: boolean }
  const logo = getLogoDataUri()
  const ecart = (compte: number, attendu: number) => {
    const d = compte - attendu
    return `<td class="num ${d === 0 ? 'ok' : 'ko'}">${d === 0 ? '0' : `${d > 0 ? '+' : ''}${formatXAF(d)}`}</td>`
  }

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${docNumber}</title>
  <style>
    @page { size: A4; margin: 14mm 12mm; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #0F172A; font-size: 11.5px; line-height: 1.45; margin: 0; }
    header { display: flex; align-items: center; gap: 12px; border-bottom: 3px solid #F5C400; padding-bottom: 10px; margin-bottom: 14px; }
    header img { width: 46px; height: 46px; }
    h1 { font-size: 18px; color: #0F4A0F; margin: 0; }
    .sub { color: #64748B; font-size: 11px; }
    .status { display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 10px; background: #E8F5E8; color: #0F4A0F; font-weight: 700; font-size: 10px; }
    h2 { font-size: 13px; color: #0F4A0F; margin: 16px 0 6px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #E2E8F0; padding: 5px 6px; text-align: left; }
    th { background: #0F4A0F; color: #fff; font-size: 10.5px; }
    td.num, th.num { text-align: right; font-family: "Courier New", monospace; }
    td.ok { color: #1A6B1A; } td.ko { color: #B91C1C; font-weight: 700; }
    tr.total td { font-weight: 700; border-top: 2px solid #0F4A0F; }
    .box { border: 1px solid #E2E8F0; border-radius: 8px; padding: 8px 10px; background: #F8FAFC; }
    .sign { display: flex; gap: 16px; margin-top: 18px; }
    .sign div { flex: 1; border: 1px solid #E2E8F0; border-radius: 8px; padding: 8px 10px; min-height: 52px; }
    .doc-footer { margin-top: 22px; text-align: center; color: #64748B; font-size: 9.5px; }
    .doc-footer .verse { font-style: italic; }
  </style></head><body>
  <header>
    ${logo ? `<img src="${logo}" alt="">` : ''}
    <div>
      <h1>Clôture mensuelle — ${e(libelle)}</h1>
      <div class="sub">${e(communityName)} · Réf. ${docNumber}</div>
      <span class="status">${STATUT_LABELS[c.statut]}</span>
    </div>
  </header>

  <h2>Activité du mois</h2>
  <table>
    <tr><td>Contributions confirmées enregistrées dans le mois</td><td class="num">${c.nbContributions}</td></tr>
    <tr><td>Montant encaissé (confirmé)</td><td class="num">${formatXAF(c.totalEncaisse)}</td></tr>
    <tr><td>Remboursements exécutés dans le mois</td><td class="num">${formatXAF(c.totalRembourse)}</td></tr>
    <tr class="total"><td>Net du mois</td><td class="num">${formatXAF(c.totalEncaisse - c.totalRembourse)}</td></tr>
  </table>

  <h2>Position des fonds au dernier jour du mois (grand livre)</h2>
  <table>
    <tr><th>Emplacement</th><th class="num">Contributions</th><th class="num">Montant</th></tr>
    ${position.byLocation.map(r => `<tr><td>${e(LOCATION_LABELS[r.location] ?? r.location)}</td><td class="num">${r.count}</td><td class="num">${formatXAF(r.amount)}</td></tr>`).join('')}
    <tr class="total"><td>Total</td><td></td><td class="num">${formatXAF(position.total)}</td></tr>
  </table>

  ${position.beforeLedgerStart ? '<p class="sub">Mois antérieur à la mise en service du grand livre : position et montants attendus non reconstituables (valeur 0).</p>' : ''}
  <h2>Rapprochement</h2>
  <table>
    <tr><th></th><th class="num">Attendu</th><th class="num">Constaté</th><th class="num">Écart</th></tr>
    <tr><td>Caisse et fonds remis au trésorier (comptés)</td><td class="num">${formatXAF(c.attenduCaisse)}</td><td class="num">${formatXAF(c.caisseComptee)}</td>${ecart(c.caisseComptee, c.attenduCaisse)}</tr>
    <tr><td>Compte bancaire (relevé)</td><td class="num">${formatXAF(c.attenduBanque)}</td><td class="num">${formatXAF(c.soldeBancaire)}</td>${ecart(c.soldeBancaire, c.attenduBanque)}</tr>
    <tr><td>Portefeuille électronique</td><td class="num">${formatXAF(c.attenduPortefeuille)}</td><td class="num">${formatXAF(c.soldePortefeuille)}</td>${ecart(c.soldePortefeuille, c.attenduPortefeuille)}</tr>
  </table>
  ${c.justification ? `<h2>Justification des écarts</h2><div class="box">${e(c.justification)}</div>` : ''}
  ${c.rejectionReason ? `<h2>Motif du refus</h2><div class="box">${e(c.rejectionReason)}</div>` : ''}

  <div class="sign">
    <div><strong>Présentée par</strong><br>${e(c.presentedByName)}<br><span class="sub">${formatDateTime(c.presentedAt)}</span></div>
    <div><strong>Visée par</strong><br>${c.validatedByName ? `${e(c.validatedByName)}<br><span class="sub">${formatDateTime(c.validatedAt!)}</span>` : '<span class="sub">En attente</span>'}</div>
  </div>
  ${c.statut === 'VALIDEE' ? '<p class="sub">Mois clos : les montants des contributions de ce mois ne peuvent plus être modifiés ; toute correction passe par une écriture du mois en cours.</p>' : ''}
  ${renderDocFooter({ communityName, verse, docNumber })}
  </body></html>`

  return renderPdf(html, { format: 'A4', printBackground: true })
}
