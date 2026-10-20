// Documents ajoutés à la refonte : relevé annuel des contributions d'un membre
// (attestation), facture de prestation, avis de remboursement.
import { getPrisma } from '../../lib/prisma'
import { renderPdf } from '../pdf-render'
import { MODE_LABELS, receiptNumber } from '../receipt'
import { monthBounds } from '../closure.service'
import { e, formatDate, formatDateTime, loadIdentity, money, pdfOptions, qrSvg, renderDocument, verificationUrl, type Tone } from './document-kit'
import { payerName } from '../contributeur-externe.service'

const prisma = getPrisma()

// ── Relevé annuel d'un membre ────────────────────────────────────────────
export const statementNumber = (memberId: string, year: number) => `REL-${year}-${memberId.replace(/^CEM-\d{4}-/, '')}`

export async function generateMemberStatementPdf(membreId: string, year: number): Promise<Buffer> {
  const membre = await prisma.membre.findUnique({ where: { id: membreId }, include: { user: { select: { fullName: true } } } })
  if (!membre) throw new Error('Membre introuvable')
  const start = monthBounds(year, 1).start
  const end = monthBounds(year, 12).end
  const [identity, contributions, refunds] = await Promise.all([
    loadIdentity(),
    prisma.contribution.findMany({
      where: { membreId, statut: 'CONFIRME', createdAt: { gte: start, lte: end } },
      select: { id: true, createdAt: true, confirmedAt: true, montant: true, modePaiement: true, periodeLabel: true, rubrique: { select: { code: true, title: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.remboursement.findMany({ where: { membreId, statut: 'EXECUTE', executedAt: { gte: start, lte: end } }, select: { montant: true, executedAt: true, motif: true } }),
  ])
  const total = contributions.reduce((s, c) => s + c.montant, 0)
  const refunded = refunds.reduce((s, r) => s + r.montant, 0)
  const byRubrique = new Map<string, { title: string; code: string; count: number; amount: number }>()
  for (const c of contributions) {
    const r = byRubrique.get(c.rubrique.code) ?? { title: c.rubrique.title, code: c.rubrique.code, count: 0, amount: 0 }
    r.count++; r.amount += c.montant
    byRubrique.set(c.rubrique.code, r)
  }
  const docNumber = statementNumber(membre.memberId, year)

  const body = `
  <section>
    <div class="parties">
      <div class="party"><div class="label">Membre</div><div class="who">${e(membre.user.fullName)}</div><div class="meta">Matricule ${e(membre.memberId)}</div></div>
      <div class="party"><div class="label">Période</div><div class="who">Année ${year}</div><div class="meta">du ${formatDate(start)} au ${formatDate(end)}</div></div>
    </div>
  </section>
  <section>
    <h2>Récapitulatif par rubrique</h2>
    <table>
      <thead><tr><th>Rubrique</th><th class="num">Versements</th><th class="num">Montant</th></tr></thead>
      <tbody>${[...byRubrique.values()].map(r => `<tr><td>${e(r.title)}<span class="sub">${e(r.code)}</span></td><td class="num">${r.count}</td><td class="num">${money(r.amount)}</td></tr>`).join('') || '<tr class="muted"><td colspan="3">Aucune contribution confirmée sur l\'année</td></tr>'}</tbody>
    </table>
    <div class="totals">
      <div><span>Total des contributions</span><span class="num">${money(total)}</span></div>
      ${refunded ? `<div><span>Remboursé</span><span class="num">− ${money(refunded)}</span></div>` : ''}
      <div class="grand"><span>Total net ${year}</span><span class="num">${money(total - refunded)}</span></div>
    </div>
  </section>
  <section class="flow">
    <h2>Détail des versements</h2>
    <table>
      <thead><tr><th>Date</th><th>Reçu</th><th>Rubrique</th><th>Moyen</th><th class="num">Montant</th></tr></thead>
      <tbody>${contributions.map(c => `<tr><td>${formatDate(c.confirmedAt ?? c.createdAt)}</td><td>${receiptNumber(c)}</td><td>${e(c.rubrique.title)}${c.periodeLabel ? `<span class="sub">${e(c.periodeLabel)}</span>` : ''}</td><td>${e(MODE_LABELS[c.modePaiement] ?? c.modePaiement)}</td><td class="num">${money(c.montant)}</td></tr>`).join('') || '<tr class="muted"><td colspan="5">Aucun versement</td></tr>'}</tbody>
    </table>
  </section>`

  const html = renderDocument({
    identity, kind: 'Relevé annuel', docNumber, issuedAt: new Date(),
    lead: `Nous attestons que <strong>${e(membre.user.fullName)}</strong> a contribué, au titre de l'année ${year}, pour un montant net de <strong>${money(total - refunded)}</strong>, selon les versements confirmés enregistrés dans SGM-CEM.`,
    body,
    signatures: [{ role: 'Le trésorier' }],
    closingNote: 'Relevé établi à la demande du membre',
  })
  return renderPdf(html, pdfOptions('A4', identity, docNumber))
}

// ── Facture de prestation ────────────────────────────────────────────────
export const invoiceNumber = (reference: string) => `FAC-${reference.replace(/^PREST-/, '')}`

export async function generatePrestationInvoicePdf(prestationId: string): Promise<Buffer> {
  const p = await prisma.prestation.findUnique({ where: { id: prestationId }, include: { entrees: { orderBy: { createdAt: 'asc' } } } })
  if (!p) throw new Error('Prestation introuvable')
  const identity = await loadIdentity()
  const docNumber = invoiceNumber(p.reference)
  const paid = p.entrees.reduce((s, x) => s + x.montant, 0)
  const due = Math.max(0, p.tarifFinal - paid)
  const status: { label: string; tone: Tone } = due === 0 ? { label: 'Acquittée', tone: 'ok' } : paid > 0 ? { label: 'Partiellement réglée', tone: 'warn' } : { label: 'À régler', tone: 'info' }
  const url = verificationUrl('facture', p.id)

  const body = `
  <section>
    <div class="parties">
      <div class="party"><div class="label">Facturé à</div><div class="who">${e(p.commanditaire)}</div>${p.commanditairePhone ? `<div class="meta">${e(p.commanditairePhone)}</div>` : ''}</div>
      <div class="party"><div class="label">Prestation</div><div class="who">${e(p.titre)}</div>
        <div class="meta">${p.dateEvenement ? `Le ${formatDate(p.dateEvenement)}` : 'Date à préciser'}${p.lieu ? ` · ${e(p.lieu)}` : ''}</div>
        <div class="meta">Réf. ${e(p.reference)}</div></div>
    </div>
  </section>
  <section>
    <table>
      <thead><tr><th>Désignation</th><th class="num">Montant</th></tr></thead>
      <tbody>
        <tr><td><strong>${e(p.titre)}</strong>${p.description ? `<span class="sub">${e(p.description.slice(0, 200))}</span>` : ''}</td><td class="num">${money(p.tarifBase)}</td></tr>
        ${p.rabaisCommanditaire > 0 ? `<tr><td>Remise accordée${p.rabaisPercent ? ` (${p.rabaisPercent.toLocaleString('fr-FR')} %)` : ''}</td><td class="num">− ${money(p.rabaisCommanditaire)}</td></tr>` : ''}
      </tbody>
    </table>
    <div class="totals">
      <div><span>Montant de la prestation</span><span class="num">${money(p.tarifFinal)}</span></div>
      <div><span>Déjà réglé</span><span class="num">${money(paid)}</span></div>
      <div class="grand"><span>Reste à payer</span><span class="num">${money(due)}</span></div>
    </div>
  </section>
  ${p.entrees.length ? `<section>
    <h2>Règlements reçus</h2>
    <table>
      <thead><tr><th>Date</th><th>Libellé</th><th>Moyen</th><th class="num">Montant</th></tr></thead>
      <tbody>${p.entrees.map(x => `<tr><td>${formatDate(x.createdAt)}</td><td>${e(x.libelle)}${x.reference ? `<span class="sub">Réf. ${e(x.reference)}</span>` : ''}</td><td>${e(MODE_LABELS[x.modePaiement] ?? x.modePaiement)}</td><td class="num">${money(x.montant)}</td></tr>`).join('')}</tbody>
    </table>
  </section>` : ''}`

  const html = renderDocument({
    identity, kind: 'Facture', docNumber, issuedAt: p.createdAt, status, body,
    signatures: [{ role: 'Pour la communauté' }],
    verification: { url, svg: await qrSvg(url) },
    closingNote: 'Association cultuelle : montants non soumis à TVA',
  })
  return renderPdf(html, pdfOptions('A4', identity, docNumber))
}

// ── Avis de remboursement ────────────────────────────────────────────────
export const refundNumber = (r: { id: string; requestedAt: Date }) => `RMB-${new Date(r.requestedAt).getFullYear()}-${r.id.slice(-8).toUpperCase()}`
const REFUND_STATUS: Record<string, { label: string; tone: Tone }> = {
  DEMANDE: { label: 'Demandé, en attente de visa', tone: 'warn' }, VALIDE: { label: 'Visé, à exécuter', tone: 'info' },
  EXECUTE: { label: 'Remboursé', tone: 'ok' }, REJETE: { label: 'Refusé', tone: 'bad' }, ANNULE: { label: 'Annulé', tone: 'bad' },
}
const MEANS: Record<string, string> = { ESPECES: 'Espèces', MOBILE_MONEY: 'Mobile Money', VIREMENT: 'Virement' }

export async function generateRefundNoticePdf(refundId: string): Promise<Buffer> {
  const r = await prisma.remboursement.findUnique({
    where: { id: refundId },
    include: { contribution: { select: { id: true, createdAt: true, montant: true, rubrique: { select: { title: true, code: true } }, membre: { select: { memberId: true, user: { select: { fullName: true } } } }, nomDonateur: true, contributeurExterne: { select: { nom: true } } } } },
  })
  if (!r) throw new Error('Remboursement introuvable')
  const identity = await loadIdentity()
  const docNumber = refundNumber(r)
  const url = verificationUrl('remboursement', r.id)
  const who = r.beneficiaire ?? payerName(r.contribution) ?? '—'

  const body = `
  <section>
    <div class="parties">
      <div class="party"><div class="label">Bénéficiaire</div><div class="who">${e(who)}</div>${r.contribution.membre ? `<div class="meta">Matricule ${e(r.contribution.membre.memberId)}</div>` : ''}</div>
      <div class="party"><div class="label">Contribution d'origine</div><div class="who">${e(receiptNumber(r.contribution))}</div><div class="meta">${e(r.contribution.rubrique.title)} · ${money(r.contribution.montant)}</div></div>
    </div>
  </section>
  <section>
    <div class="kv">
      <div><span>Moyen</span><span>${e(MEANS[r.moyen] ?? r.moyen)}</span></div>
      <div><span>Référence</span><span>${e(r.reference ?? '—')}</span></div>
      <div><span>Demandé par</span><span>${e(r.requestedByName)}</span></div>
      <div><span>Visé par</span><span>${e(r.validatedByName ?? '—')}</span></div>
    </div>
    <div class="note"><strong>Motif :</strong> ${e(r.motif)}</div>
    <div class="totals"><div class="grand"><span>Montant remboursé</span><span class="num">${money(r.montant)}</span></div></div>
  </section>`

  const html = renderDocument({
    identity, kind: 'Avis de remboursement', docNumber, issuedAt: r.executedAt ?? r.requestedAt,
    status: REFUND_STATUS[r.statut] ?? REFUND_STATUS.DEMANDE, body,
    signatures: [
      { role: 'Exécuté par', name: r.executedByName, when: r.executedAt ? formatDateTime(r.executedAt) : null },
      { role: 'Le bénéficiaire' },
    ],
    verification: { url, svg: await qrSvg(url) },
    closingNote: 'La contribution d\'origine reste enregistrée ; le remboursement en est déduit',
  })
  return renderPdf(html, pdfOptions('A5', identity, docNumber))
}
