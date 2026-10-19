// PDF de clôture mensuelle (lot 4.2) : produit depuis l'instantané enregistré,
// donc identique à chaque téléchargement ; porte le présentateur et le viseur.
import type { ClotureMensuelle } from '@prisma/client'
import { renderPdf } from './pdf-render'
import { MOIS } from './closure.service'
import { e, formatDateTime, loadIdentity, money, pdfOptions, renderDocument, type Tone } from './documents/document-kit'

const LOCATION_LABELS: Record<string, string> = {
  CHEZ_COLLECTEUR: 'Chez les collecteurs', EN_TRANSIT: 'En transit', CHEZ_RESPONSABLE: 'Chez les responsables',
  REMIS_TRESORIER: 'Remis au trésorier', EN_CAISSE: 'En caisse', EN_BANQUE: 'En banque', PORTEFEUILLE_ELECTRONIQUE: 'Portefeuille électronique',
}

const STATUTS: Record<string, { label: string; tone: Tone }> = {
  PRESENTEE: { label: 'Présentée, en attente de visa', tone: 'warn' },
  VALIDEE: { label: 'Visée : mois clos', tone: 'ok' },
  REJETEE: { label: 'Refusée', tone: 'bad' },
}

export const closureNumber = (c: { annee: number; mois: number }) => `CLO-${c.annee}-${String(c.mois).padStart(2, '0')}`

export async function renderClosurePdf(c: ClotureMensuelle): Promise<Buffer> {
  const identity = await loadIdentity()
  const docNumber = closureNumber(c)
  const position = c.positionFin as unknown as { byLocation: Array<{ location: string; amount: number; count: number }>; total: number; beforeLedgerStart?: boolean }
  const gap = (counted: number, expected: number) => {
    const d = counted - expected
    return `<td class="num ${d === 0 ? 'pos' : 'neg'}">${d === 0 ? '0' : `${d > 0 ? '+' : '−'}${money(Math.abs(d))}`}</td>`
  }

  const body = `
  <section>
    <h2>Activité du mois</h2>
    <div class="kpis">
      <div class="kpi"><div class="k">Contributions</div><div class="v">${c.nbContributions}</div><div class="s">confirmées dans le mois</div></div>
      <div class="kpi"><div class="k">Encaissé</div><div class="v">${money(c.totalEncaisse)}</div></div>
      <div class="kpi"><div class="k">Remboursé</div><div class="v">${money(c.totalRembourse)}</div></div>
      <div class="kpi gold"><div class="k">Net du mois</div><div class="v">${money(c.totalEncaisse - c.totalRembourse)}</div></div>
    </div>
  </section>
  <section>
    <h2>Position des fonds au dernier jour du mois</h2>
    ${position.beforeLedgerStart ? '<div class="note">Mois antérieur à la mise en service du grand livre : position et montants attendus non reconstituables (valeur 0).</div>' : ''}
    <table>
      <thead><tr><th>Emplacement</th><th class="num">Contributions</th><th class="num">Montant</th></tr></thead>
      <tbody>${position.byLocation.map(r => `<tr><td>${e(LOCATION_LABELS[r.location] ?? r.location)}</td><td class="num">${r.count}</td><td class="num">${money(r.amount)}</td></tr>`).join('')}
        <tr class="total"><td>Total</td><td></td><td class="num">${money(position.total)}</td></tr></tbody>
    </table>
  </section>
  <section>
    <h2>Rapprochement</h2>
    <table>
      <thead><tr><th></th><th class="num">Attendu</th><th class="num">Constaté</th><th class="num">Écart</th></tr></thead>
      <tbody>
        <tr><td>Caisse et fonds remis au trésorier (comptés)</td><td class="num">${money(c.attenduCaisse)}</td><td class="num">${money(c.caisseComptee)}</td>${gap(c.caisseComptee, c.attenduCaisse)}</tr>
        <tr><td>Compte bancaire (relevé)</td><td class="num">${money(c.attenduBanque)}</td><td class="num">${money(c.soldeBancaire)}</td>${gap(c.soldeBancaire, c.attenduBanque)}</tr>
        <tr><td>Portefeuille électronique</td><td class="num">${money(c.attenduPortefeuille)}</td><td class="num">${money(c.soldePortefeuille)}</td>${gap(c.soldePortefeuille, c.attenduPortefeuille)}</tr>
      </tbody>
    </table>
    ${c.justification ? `<div class="note"><strong>Justification des écarts :</strong> ${e(c.justification)}</div>` : ''}
    ${c.rejectionReason ? `<div class="note"><strong>Motif du refus :</strong> ${e(c.rejectionReason)}</div>` : ''}
  </section>`

  const html = renderDocument({
    identity, kind: 'Clôture mensuelle', docNumber, issuedAt: c.validatedAt ?? c.presentedAt,
    status: STATUTS[c.statut] ?? STATUTS.PRESENTEE,
    lead: `Mois de <strong>${e(MOIS[c.mois - 1])} ${c.annee}</strong>. ${c.statut === 'VALIDEE' ? 'Mois clos : les montants de ses contributions ne peuvent plus être modifiés ; toute correction passe par une écriture du mois en cours.' : ''}`,
    body,
    signatures: [
      { role: 'Présentée par', name: c.presentedByName, when: formatDateTime(c.presentedAt) },
      { role: 'Visée par', name: c.validatedByName, when: c.validatedAt ? formatDateTime(c.validatedAt) : 'En attente' },
    ],
    closingNote: 'Établie depuis l\'instantané enregistré à la présentation',
  })
  return renderPdf(html, pdfOptions('A4', identity, docNumber))
}
