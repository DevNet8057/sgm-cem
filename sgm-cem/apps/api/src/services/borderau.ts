import { renderPdf } from './pdf-render'
import { storeFile } from './storage'
import { e, formatDate, formatDateTime, loadIdentity, money, pdfOptions, qrSvg, renderDocument, verificationUrl, type Tone } from './documents/document-kit'
import { getPrisma } from '../lib/prisma'

const prisma = getPrisma()

const TRANSFER_TYPE_LABELS: Record<string, string> = {
  ESPECES_EN_MAIN: 'Remise en main propre (espèces)',
  DEPOT_MTN: 'Dépôt MTN MoMo',
  DEPOT_ORANGE: 'Dépôt Orange Money',
  AUTRE: 'Autre mode',
}

export function borderauNumber(transfer: { id: string; createdAt: Date }): string {
  const year = new Date(transfer.createdAt).getFullYear()
  return `BRD-${year}-${transfer.id.slice(-8).toUpperCase()}`
}

const ROLE_LABELS: Record<string, string> = {
  DEVELOPER: 'Développeur', ADMIN: 'Administrateur', TRESORIER: 'Trésorier', RESPONSABLE: 'Responsable',
  ADJOINT_RESPONSABLE: 'Responsable adjoint', COLLECTEUR: 'Collecteur', MEMBRE: 'Membre',
}

const STATUTS: Record<string, { label: string; tone: Tone }> = {
  CONFIRMED: { label: 'Remise confirmée par le destinataire', tone: 'ok' },
  PENDING_APPROVAL: { label: 'En attente de confirmation du destinataire', tone: 'warn' },
  REFUSED: { label: 'Remise refusée', tone: 'bad' },
  CANCELLED: { label: 'Remise annulée', tone: 'bad' },
}

export async function generateBorderauHtml(transferId: string): Promise<string> {
  const transfer = await prisma.fundsTransfer.findUnique({
    where: { id: transferId },
    include: {
      contributions: {
        include: {
          membre: { include: { user: { select: { fullName: true } } } },
          contributeurExterne: { select: { nom: true } },
          rubrique: { select: { code: true, title: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      sender: { select: { fullName: true, role: true } },
      receiver: { select: { fullName: true, role: true } },
    },
  })
  if (!transfer) throw new Error('Transfert introuvable')

  const identity = await loadIdentity()
  const numero = borderauNumber(transfer)
  const confirmed = transfer.status === 'CONFIRMED'
  const url = verificationUrl('bordereau', transfer.id)
  const rows = transfer.contributions.map((c, i) => `
      <tr><td class="num">${i + 1}</td>
        <td>${e(c.membre?.user.fullName ?? (c.contributeurExterne ? `${c.contributeurExterne.nom} (don public)` : 'Remise groupée'))}</td>
        <td>${e(c.rubrique?.title ?? '-')}<span class="sub">${e(c.rubrique?.code ?? '')}</span></td>
        <td>${formatDate(c.createdAt)}</td>
        <td class="num">${money(c.montant)}</td></tr>`).join('')

  const body = `
  <section>
    <div class="parties">
      <div class="party"><div class="label">Remis par</div><div class="who">${e(transfer.senderName)}</div><div class="meta">${e(ROLE_LABELS[transfer.sender.role] ?? transfer.sender.role)}</div></div>
      <div class="party"><div class="label">Reçu par</div><div class="who">${e(transfer.receiverName)}</div><div class="meta">${e(ROLE_LABELS[transfer.receiver.role] ?? transfer.receiver.role)}</div></div>
    </div>
  </section>
  <section>
    <div class="kv three">
      <div><span>Mode de remise</span><span>${e(TRANSFER_TYPE_LABELS[transfer.transferType] ?? transfer.transferType)}</span></div>
      <div><span>Contributions</span><span>${transfer.contributions.length}</span></div>
      <div><span>${confirmed ? 'Confirmée le' : 'Remise le'}</span><span>${formatDateTime(transfer.confirmedAt ?? transfer.createdAt)}</span></div>
    </div>
  </section>
  <section class="flow">
    <h2>Détail des contributions remises</h2>
    <table>
      <thead><tr><th class="num">N°</th><th>Payeur</th><th>Rubrique</th><th>Date</th><th class="num">Montant</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">Aucune contribution</td></tr>'}
        <tr class="total"><td colspan="4">Total remis</td><td class="num">${money(transfer.totalAmount)}</td></tr></tbody>
    </table>
    ${transfer.senderNote ? `<div class="note"><strong>Note de l'expéditeur :</strong> ${e(transfer.senderNote)}</div>` : ''}
  </section>`

  return renderDocument({
    identity, kind: 'Bordereau de remise', docNumber: numero, issuedAt: transfer.createdAt,
    status: STATUTS[transfer.status] ?? STATUTS.PENDING_APPROVAL,
    body,
    signatures: [
      { role: 'Remis par', name: transfer.senderName, when: formatDate(transfer.createdAt) },
      { role: 'Reçu par', name: transfer.receiverName, when: transfer.confirmedAt ? formatDate(transfer.confirmedAt) : null },
    ],
    verification: { url, svg: await qrSvg(url) },
    closingNote: "Bordereau de remise de fonds entre membres de l'équipe de collecte",
  })
}

export async function generateBorderauPdf(transferId: string): Promise<Buffer> {
  const html = await generateBorderauHtml(transferId)
  const t = await prisma.fundsTransfer.findUniqueOrThrow({ where: { id: transferId }, select: { id: true, createdAt: true } })
  return renderPdf(html, pdfOptions('A4', await loadIdentity(), borderauNumber(t)))
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
