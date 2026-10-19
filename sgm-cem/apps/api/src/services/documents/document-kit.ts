// Gabarit commun de tous les documents imprimables (reçus, bordereaux, factures,
// avis, relevés, rapports, clôtures) : une seule identité visuelle, polices
// intégrées (le rendu PDF n'accède à aucune ressource extérieure), en-tête,
// bandeau de statut, tableaux, signatures, code QR de vérification et pied de
// page paginé.
import fs from 'fs'
import path from 'path'
import { createHmac } from 'crypto'
import QRCode from 'qrcode'
import { getPrisma } from '../../lib/prisma'
import { getJwtSecret } from '../../lib/security'
import { getConfig } from '../config.service'
import { escapeHtml as e, formatDate, formatDateTime, getLogoDataUri } from '../pdf-branding'

export { e, formatDate, formatDateTime }

const prisma = getPrisma()

// ── Identité de la communauté (Paramètres → Identité des documents) ─────
export interface DocIdentity {
  name: string
  address: string
  phone: string | null
  email: string | null
  legalId: string | null
  verse: string
}

export async function loadIdentity(): Promise<DocIdentity> {
  const s = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } })
  return {
    name: s?.communityName ?? "Culte d'Enfants de Melen",
    address: s?.communityAddress ?? 'Église Évangélique du Cameroun, paroisse de Melen — Yaoundé, Cameroun',
    phone: s?.communityPhone ?? null,
    email: s?.communityEmail ?? null,
    legalId: s?.communityLegalId ?? null,
    verse: s?.communityVerse ?? '',
  }
}

// ── Polices intégrées (base64, sous-ensemble latin) ───────────────────
let fontCss: string | null = null
function fontFace(family: string, file: string, weight: number, style = 'normal'): string {
  try {
    const p = path.join(path.dirname(require.resolve(`@fontsource/${file.split('/')[0]}/package.json`)), 'files', file.split('/')[1])
    const b64 = fs.readFileSync(p).toString('base64')
    return `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};src:url(data:font/woff2;base64,${b64}) format("woff2");}`
  } catch {
    return '' // police absente : repli sur les polices du système
  }
}
function fonts(): string {
  if (fontCss !== null) return fontCss
  fontCss = [
    fontFace('Doc Display', 'montserrat/montserrat-latin-600-normal.woff2', 600),
    fontFace('Doc Display', 'montserrat/montserrat-latin-700-normal.woff2', 700),
    fontFace('Doc Text', 'source-sans-3/source-sans-3-latin-400-normal.woff2', 400),
    fontFace('Doc Text', 'source-sans-3/source-sans-3-latin-400-italic.woff2', 400, 'italic'),
    fontFace('Doc Text', 'source-sans-3/source-sans-3-latin-600-normal.woff2', 600),
    fontFace('Doc Text', 'source-sans-3/source-sans-3-latin-700-normal.woff2', 700),
  ].join('')
  return fontCss
}

// ── Vérification en ligne (code QR) ──────────────────────────────────────
export type VerifiableKind = 'recu' | 'facture' | 'remboursement' | 'bordereau'

/** Signature courte qui empêche de fabriquer un lien de vérification. */
export function verificationSignature(kind: VerifiableKind, id: string): string {
  return createHmac('sha256', getJwtSecret()).update(`verif:${kind}:${id}`).digest('base64url').slice(0, 16)
}

export function verificationUrl(kind: VerifiableKind, id: string): string {
  const base = (getConfig('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '')
  return `${base}/verifier/${kind}/${id}?s=${verificationSignature(kind, id)}`
}

export async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0F2E14', light: '#FFFFFF' } })
}

// ── Mise en forme ────────────────────────────────────────────────────────
export function money(amount: number): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(amount).replace(/ | /g, ' ')} FCFA`
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info'

export const DOC_CSS = `
  :root { --green:#0F4A0F; --green-2:#1A6B1A; --gold:#C9A400; --gold-soft:#FFF6D1; --ink:#14201A; --muted:#5B6B62; --line:#DDE5DF; --wash:#F5F8F5; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Doc Text", "Liberation Sans", Arial, sans-serif; color: var(--ink); font-size: 10.5pt; line-height: 1.42; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1, h2, h3, .display { font-family: "Doc Display", "Liberation Sans", Arial, sans-serif; }
  .num, td.num, th.num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }

  .masthead { display: flex; align-items: flex-start; gap: 14px; padding-bottom: 12px; border-bottom: 2.5px solid var(--green); position: relative; }
  .masthead::after { content: ""; position: absolute; left: 0; right: 0; bottom: -6px; border-bottom: 1px solid var(--gold); }
  .masthead .logo { width: 54px; height: 54px; flex-shrink: 0; }
  .masthead .logo img { width: 100%; height: 100%; object-fit: contain; }
  .masthead .org { flex: 1; min-width: 0; }
  .masthead .org .name { font-family: "Doc Display", Arial, sans-serif; font-weight: 700; font-size: 13.5pt; color: var(--green); letter-spacing: .2px; }
  .masthead .org .line { font-size: 8.6pt; color: var(--muted); margin-top: 1px; }
  .masthead .doc { text-align: right; flex-shrink: 0; max-width: 46%; }
  .masthead .doc .kind { font-family: "Doc Display", Arial, sans-serif; font-weight: 700; font-size: 12.5pt; text-transform: uppercase; letter-spacing: 1.2px; color: var(--ink); }
  .masthead .doc .ref { font-size: 9.5pt; font-weight: 700; color: var(--green); margin-top: 3px; letter-spacing: .4px; }
  .masthead .doc .date { font-size: 8.6pt; color: var(--muted); margin-top: 1px; }

  .status { display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; padding: 4px 11px; border-radius: 999px; font-weight: 700; font-size: 8.6pt; letter-spacing: .6px; text-transform: uppercase; border: 1px solid; }
  .status.ok { color: var(--green); background: #E9F4EA; border-color: #B9DABC; }
  .status.warn { color: #8A5A00; background: #FFF4DA; border-color: #EBD08C; }
  .status.bad { color: #9B1C1C; background: #FDECEC; border-color: #F2B8B8; }
  .status.info { color: #1E3A8A; background: #EAF0FD; border-color: #BCCDF5; }

  .lead { margin-top: 14px; font-size: 10pt; color: var(--muted); }
  section { margin-top: 18px; break-inside: avoid; }
  section.flow { break-inside: auto; }
  h2 { font-weight: 700; font-size: 10.5pt; color: var(--green); text-transform: uppercase; letter-spacing: .9px; margin-bottom: 7px; display: flex; align-items: center; gap: 8px; }
  h2::after { content: ""; flex: 1; border-bottom: 1px solid var(--line); }
  h2 { break-after: avoid; page-break-after: avoid; }
  /* Un titre ne reste jamais seul en bas de page : il part avec le début de son contenu */
  section.flow > h2 + * { break-before: avoid; }

  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .party { border: 1px solid var(--line); border-radius: 6px; padding: 9px 12px; }
  .party .label { font-size: 7.6pt; color: var(--muted); text-transform: uppercase; letter-spacing: .8px; font-weight: 700; }
  .party .who { font-weight: 700; font-size: 10.5pt; margin-top: 2px; }
  .party .meta { font-size: 8.8pt; color: var(--muted); }

  .kv { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 18px; }
  .kv.three { grid-template-columns: repeat(3, 1fr); }
  .kv > div { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; border-bottom: 1px dotted var(--line); font-size: 9.4pt; }
  .kv > div span:first-child { color: var(--muted); }
  .kv > div span:last-child { font-weight: 600; text-align: right; }

  table { width: 100%; border-collapse: collapse; font-size: 9.4pt; }
  thead { display: table-header-group; }
  th { text-align: left; font-family: "Doc Display", Arial, sans-serif; font-weight: 600; font-size: 7.8pt; text-transform: uppercase; letter-spacing: .7px; color: var(--green); padding: 6px 7px; border-bottom: 1.5px solid var(--green); background: var(--wash); }
  td { padding: 6px 7px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr { break-inside: avoid; }
  td .sub { display: block; font-size: 8.2pt; color: var(--muted); }
  tr.total td { font-weight: 700; border-top: 1.5px solid var(--green); border-bottom: none; background: var(--wash); }
  tr.muted td { color: var(--muted); }
  td.neg { color: #9B1C1C; }
  td.pos { color: var(--green); }

  .totals { margin-left: auto; width: 58%; margin-top: 8px; }
  .totals > div { display: flex; justify-content: space-between; padding: 4px 8px; font-size: 9.6pt; }
  .totals > div.grand { margin-top: 4px; padding: 9px 10px; background: var(--green); color: #fff; border-radius: 5px; font-family: "Doc Display", Arial, sans-serif; font-weight: 700; font-size: 11.5pt; }

  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .kpi { border: 1px solid var(--line); border-top: 3px solid var(--green); border-radius: 5px; padding: 8px 10px; }
  .kpi.gold { border-top-color: var(--gold); }
  .kpi .k { font-size: 7.6pt; color: var(--muted); text-transform: uppercase; letter-spacing: .7px; font-weight: 700; }
  .kpi .v { font-family: "Doc Display", Arial, sans-serif; font-weight: 700; font-size: 12.5pt; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .kpi .s { font-size: 8pt; color: var(--muted); margin-top: 1px; }

  .bar { height: 7px; background: #E8EEE9; border-radius: 4px; overflow: hidden; min-width: 60px; }
  .bar > span { display: block; height: 100%; background: var(--green-2); border-radius: 4px; }
  .note { margin-top: 10px; padding: 8px 11px; border-left: 3px solid var(--gold); background: var(--gold-soft); font-size: 9pt; border-radius: 0 5px 5px 0; }

  .closing { display: flex; gap: 16px; margin-top: 22px; align-items: flex-end; break-inside: avoid; }
  .signatures { flex: 1; display: grid; grid-template-columns: repeat(var(--cols, 2), 1fr); gap: 16px; }
  .sig { border-top: 1px solid var(--ink); padding-top: 4px; min-height: 58px; display: flex; flex-direction: column; justify-content: flex-end; }
  .sig .role { font-size: 8.2pt; color: var(--muted); text-transform: uppercase; letter-spacing: .6px; font-weight: 700; }
  .sig .name { font-size: 9.2pt; font-weight: 600; }
  .sig .when { font-size: 8.2pt; color: var(--muted); }
  .sig.blank { justify-content: flex-start; }
  .verify { width: 92px; text-align: center; flex-shrink: 0; }
  .verify a { display: block; line-height: 0; }
  .verify svg { width: 80px; height: 80px; }
  .verify .t { font-size: 6.8pt; color: var(--muted); line-height: 1.2; margin-top: 3px; }

  .colophon { margin-top: 18px; padding-top: 8px; border-top: 1px solid var(--line); font-size: 8pt; color: var(--muted); text-align: center; break-inside: avoid; }
  .colophon .verse { font-style: italic; color: var(--green); margin-bottom: 3px; }
  .page-break { break-before: page; }
`

// Pied de page répété sur chaque page (numéro de page) : styles en ligne, sans
// police intégrée (le gabarit de pied de page n'hérite pas de la page)
export function pageFooterTemplate(identity: DocIdentity, docNumber: string): string {
  return `<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5pt;color:#5B6B62;padding:0 12mm;display:flex;justify-content:space-between;">
    <span>${e(identity.name)} · ${e(docNumber)}</span>
    <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`
}

export interface DocumentOptions {
  identity: DocIdentity
  kind: string // « Reçu », « Facture », « Rapport financier »…
  docNumber: string
  issuedAt: Date
  status?: { label: string; tone: Tone }
  lead?: string
  body: string
  signatures?: Array<{ role: string; name?: string | null; when?: string | null }>
  verification?: { url: string; svg: string }
  closingNote?: string
}

/** Document HTML complet, prêt pour renderPdf (aucune ressource extérieure). */
export function renderDocument(o: DocumentOptions): string {
  const logo = getLogoDataUri()
  const id = o.identity
  const contacts = [id.phone, id.email].filter(Boolean).map(v => e(v)).join(' · ')
  const sigs = o.signatures ?? []
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${e(o.kind)} ${e(o.docNumber)}</title>
  <style>${fonts()}${DOC_CSS}</style></head><body>
  <header class="masthead">
    ${logo ? `<div class="logo"><img src="${logo}" alt=""></div>` : ''}
    <div class="org">
      <div class="name">${e(id.name)}</div>
      <div class="line">${e(id.address)}</div>
      ${contacts ? `<div class="line">${contacts}</div>` : ''}
      ${id.legalId ? `<div class="line">${e(id.legalId)}</div>` : ''}
    </div>
    <div class="doc">
      <div class="kind">${e(o.kind)}</div>
      <div class="ref">N° ${e(o.docNumber)}</div>
      <div class="date">Émis le ${formatDate(o.issuedAt)}</div>
    </div>
  </header>
  ${o.status ? `<div class="status ${o.status.tone}">${e(o.status.label)}</div>` : ''}
  ${o.lead ? `<p class="lead">${o.lead}</p>` : ''}
  ${o.body}
  ${(sigs.length || o.verification) ? `<div class="closing">
    <div class="signatures" style="--cols:${Math.max(1, sigs.length)}">
      ${sigs.map(s => `<div class="sig${s.name ? '' : ' blank'}"><span class="role">${e(s.role)}</span>${s.name ? `<span class="name">${e(s.name)}</span>` : ''}${s.when ? `<span class="when">${e(s.when)}</span>` : ''}</div>`).join('')}
    </div>
    ${o.verification ? `<div class="verify"><a href="${e(o.verification.url)}">${o.verification.svg}</a><div class="t">Vérifier l'authenticité : scannez ou cliquez ce code</div></div>` : ''}
  </div>` : ''}
  <footer class="colophon">
    ${id.verse ? `<div class="verse">« ${e(id.verse.slice(0, 160))} »</div>` : ''}
    <div>${o.closingNote ? `${e(o.closingNote)} · ` : ''}Document établi par SGM-CEM le ${formatDateTime(new Date())}</div>
  </footer>
  </body></html>`
}

/** Options PDF communes : marges, fond imprimé, pied de page paginé. */
export function pdfOptions(format: 'A4' | 'A5', identity: DocIdentity, docNumber: string) {
  const m = format === 'A5' ? '10mm' : '14mm'
  return {
    format,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: pageFooterTemplate(identity, docNumber),
    margin: { top: m, right: m, bottom: '16mm', left: m },
  } as const
}
