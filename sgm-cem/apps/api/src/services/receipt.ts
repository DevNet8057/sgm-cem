// Reçu de contribution (A5) : gabarit commun des documents, code QR de vérification.
import { storeFile } from './storage'
import { renderPdf } from './pdf-render'
import { getPrisma } from '../lib/prisma'
import { e, formatDateTime, loadIdentity, money, pdfOptions, qrSvg, renderDocument, verificationUrl, type Tone } from './documents/document-kit'
import { payerName } from './contributeur-externe.service'

const prisma = getPrisma()

export const MODE_LABELS: Record<string, string> = {
  ESPECES: 'Espèces', MTN_MOMO: 'MTN Mobile Money', ORANGE_MONEY: 'Orange Money',
  YELII: 'Mobile Money', CARTE_VISA: 'Carte bancaire', VIREMENT: 'Virement bancaire',
}

const STATUTS: Record<string, { label: string; tone: Tone }> = {
  CONFIRME: { label: 'Paiement confirmé', tone: 'ok' },
  EN_ATTENTE_CONFIRMATION: { label: 'En attente de confirmation', tone: 'warn' },
  ANNULE: { label: 'Paiement annulé', tone: 'bad' },
  LITIGE: { label: 'En cours de vérification', tone: 'bad' },
}

/** Numéro de reçu lisible et stable, dérivé de l'ID — pas de compteur séparé à maintenir. */
export function receiptNumber(contribution: { id: string; createdAt: Date }): string {
  return `REC-${new Date(contribution.createdAt).getFullYear()}-${contribution.id.slice(-8).toUpperCase()}`
}

export async function generateReceiptHtml(contributionId: string): Promise<string> {
  const c = await prisma.contribution.findUnique({
    where: { id: contributionId },
    include: {
      membre: { include: { user: { select: { fullName: true, phone: true } } } },
      contributeurExterne: { select: { nom: true, phone: true } },
      rubrique: { select: { code: true, title: true } },
      collecteur: { select: { fullName: true } },
    },
  })
  if (!c) throw new Error('Contribution introuvable')

  const identity = await loadIdentity()
  const numero = receiptNumber(c)
  const payer = payerName(c) ?? 'Contributeur'
  const payerPhone = c.membre?.user.phone ?? c.contributeurExterne?.phone
  const fees = c.commissionPaidByPayer && c.commissionPaidByPayer > 0 ? c.commissionPaidByPayer : 0
  const total = c.amountChargedToPayer ?? c.montant
  const url = verificationUrl('recu', c.id)

  const body = `
  <section>
    <div class="parties">
      <div class="party"><div class="label">Reçu de</div><div class="who">${e(payer)}</div>
        <div class="meta">${c.membre ? `Matricule ${e(c.membre.memberId)}` : 'Donateur (collecte publique)'}</div>
        ${payerPhone ? `<div class="meta">${e(payerPhone)}</div>` : ''}</div>
      <div class="party"><div class="label">Encaissé par</div><div class="who">${e(c.collecteur?.fullName ?? 'Paiement en ligne')}</div>
        <div class="meta">${e(MODE_LABELS[c.modePaiement] ?? c.modePaiement)}</div>
        <div class="meta">Réf. ${e(String(c.referencePaiement ?? c.externalTransactionId ?? c.id).slice(0, 28))}</div></div>
    </div>
  </section>
  <section>
    <table>
      <thead><tr><th>Désignation</th><th class="num">Montant</th></tr></thead>
      <tbody>
        <tr><td><strong>${e(c.rubrique.title)}</strong><span class="sub">Rubrique ${e(c.rubrique.code)}${c.periodeLabel ? ` · période ${e(c.periodeLabel)}` : ''}</span></td><td class="num">${money(c.montant)}</td></tr>
        ${fees ? `<tr class="muted"><td>Frais de transaction Mobile Money, à la charge du payeur</td><td class="num">${money(fees)}</td></tr>` : ''}
      </tbody>
    </table>
    <div class="totals">
      ${fees ? `<div><span>Montant crédité à la rubrique</span><span class="num">${money(c.montant)}</span></div>` : ''}
      <div class="grand"><span>${fees ? 'Total débité' : 'Total reçu'}</span><span class="num">${money(fees ? total : c.montant)}</span></div>
    </div>
  </section>
  <section>
    <div class="kv">
      <div><span>${c.confirmedAt ? 'Confirmé le' : 'Enregistré le'}</span><span>${formatDateTime(c.confirmedAt ?? c.createdAt)}</span></div>
      <div><span>Déclaré le</span><span>${formatDateTime(c.createdAt)}</span></div>
    </div>
  </section>`

  return renderDocument({
    identity, kind: 'Reçu', docNumber: numero, issuedAt: c.confirmedAt ?? c.createdAt,
    status: STATUTS[c.statut] ?? STATUTS.EN_ATTENTE_CONFIRMATION,
    body,
    signatures: c.modePaiement === 'ESPECES' ? [{ role: 'Le collecteur' }, { role: 'Le contributeur' }] : [],
    verification: { url, svg: await qrSvg(url) },
    closingNote: 'Ce reçu atteste le paiement indiqué ; à conserver',
  })
}

export async function generateReceiptPdf(contributionId: string): Promise<Buffer> {
  const html = await generateReceiptHtml(contributionId)
  const c = await prisma.contribution.findUniqueOrThrow({ where: { id: contributionId }, select: { id: true, createdAt: true } })
  return renderPdf(html, pdfOptions('A5', await loadIdentity(), receiptNumber(c)))
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
