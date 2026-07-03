import fs from 'fs'
import path from 'path'

/**
 * Identité visuelle partagée par tous les documents PDF générés (reçus,
 * bordereaux, rapports) — garantit un rendu cohérent dans toute l'app.
 */
let logoDataUri: string | null = null
export function getLogoDataUri(): string {
  if (logoDataUri) return logoDataUri
  try {
    const logoPath = path.join(process.cwd(), 'assets', 'cem-logo.png')
    const buffer = fs.readFileSync(logoPath)
    logoDataUri = `data:image/png;base64,${buffer.toString('base64')}`
  } catch {
    logoDataUri = ''
  }
  return logoDataUri
}

export function formatXAF(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(amount) + ' FCFA'
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** CSS partagé — palette et typographie identiques sur tous les documents. */
export const PDF_BASE_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #0F172A; background: #fff; }
  .doc-header { background: linear-gradient(135deg, #0F4A0F 0%, #1A6B1A 55%, #1A6B1A 100%); color: white; padding: 16px 20px; border-radius: 10px; margin-bottom: 16px; display: flex; align-items: center; gap: 14px; }
  .doc-header .logo-box { width: 48px; height: 48px; background: white; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden; padding: 4px; }
  .doc-header .logo-box img { width: 100%; height: 100%; object-fit: contain; }
  .doc-header .htext { flex: 1; min-width: 0; }
  .doc-header .htext h1 { font-size: 17px; font-weight: 700; letter-spacing: 0.2px; }
  .doc-header .htext p { font-size: 10.5px; opacity: 0.75; margin-top: 2px; }
  .doc-header .hmeta { text-align: right; flex-shrink: 0; }
  .doc-header .hmeta .num { font-family: "Courier New", monospace; font-size: 11.5px; font-weight: 700; }
  .doc-header .hmeta .date { font-size: 10px; opacity: 0.75; margin-top: 2px; }
  .doc-footer { border-top: 1px dashed #CBD5E1; padding-top: 10px; text-align: center; font-size: 9.5px; color: #94A3B8; margin-top: 16px; }
  .doc-footer strong { color: #0F4A0F; }
  .doc-footer .verse { font-style: italic; margin-top: 4px; }
  .doc-footer .meta { margin-top: 8px; font-size: 8.5px; }
`

export function renderDocHeader(opts: { title: string; subtitle: string; docNumber: string; date: string }): string {
  return `
  <div class="doc-header">
    <div class="logo-box">${getLogoDataUri() ? `<img src="${getLogoDataUri()}" alt="Logo" />` : ''}</div>
    <div class="htext">
      <h1>${escapeHtml(opts.title)}</h1>
      <p>${escapeHtml(opts.subtitle)}</p>
    </div>
    <div class="hmeta">
      <div class="num">${escapeHtml(opts.docNumber)}</div>
      <div class="date">${escapeHtml(opts.date)}</div>
    </div>
  </div>`
}

export function renderDocFooter(opts: { communityName: string; verse: string; docNumber: string }): string {
  return `
  <div class="doc-footer">
    <p>Document délivré par <strong>SGM-CEM</strong> &bull; ${escapeHtml(opts.communityName)}</p>
    <p class="verse">"${escapeHtml(opts.verse.substring(0, 90))}"</p>
    <p class="meta">Réf. ${escapeHtml(opts.docNumber)} &bull; Généré le ${formatDateTime(new Date())} &bull; Document officiel — à conserver</p>
  </div>`
}
