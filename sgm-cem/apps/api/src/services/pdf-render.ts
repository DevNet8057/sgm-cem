import puppeteer, { type Browser, type PDFOptions } from 'puppeteer'
import fs from 'fs'
import { getConfigNumber } from './config.service'

/**
 * Docker fournit Chromium via PUPPETEER_EXECUTABLE_PATH. En développement
 * Windows, Puppeteer est installé sans son navigateur afin d'alléger le dépôt :
 * utiliser Chrome local quand il est présent pour que les documents restent testables.
 */
function resolveBrowserExecutable(): string | undefined {
  const configured = process.env.PUPPETEER_EXECUTABLE_PATH
  if (configured) return configured
  if (process.platform !== 'win32') return undefined

  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  return fs.existsSync(chrome) ? chrome : undefined
}

// ── Rendu isolé (lot 3.2, ADR-007) ─────────────────────────────────────
// Option 1 (recommandée en production) : Gotenberg, conteneur interne sans
// sortie réseau ni JavaScript, appelé si GOTENBERG_URL est défini.
// Option 2 : Chromium local, UN navigateur partagé, un contexte isolé par
// document et un nombre limité de rendus simultanés (PDF_CONCURRENCY, défaut 2)
// — auparavant chaque PDF lançait son propre navigateur, sans limite.

let browser: Promise<Browser> | null = null
let idleTimer: NodeJS.Timeout | null = null
let active = 0
const waiting: Array<() => void> = []
const IDLE_CLOSE_MS = 60_000

async function acquire(): Promise<void> {
  const limit = Math.max(1, getConfigNumber('PDF_CONCURRENCY', 2))
  if (active < limit) { active++; return }
  await new Promise<void>(resolve => waiting.push(resolve))
  active++
}

function release(): void {
  active--
  waiting.shift()?.()
}

function getBrowser(): Promise<Browser> {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  if (!browser) {
    const executablePath = resolveBrowserExecutable()
    browser = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      ...(executablePath ? { executablePath } : {}),
    }).then(b => {
      b.on('disconnected', () => { browser = null })
      return b
    }).catch(err => { browser = null; throw err })
  }
  return browser
}

// Navigateur fermé après une minute sans rendu : pas de Chromium résident inutile
function scheduleIdleClose(): void {
  if (active > 0 || !browser) return
  idleTimer = setTimeout(() => { void closePdfRenderer() }, IDLE_CLOSE_MS)
  idleTimer.unref()
}

export async function closePdfRenderer(): Promise<void> {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  const current = browser
  browser = null
  if (current) await (await current).close().catch(() => {})
}

async function renderLocally(html: string, options: PDFOptions): Promise<Buffer> {
  await acquire()
  try {
    const context = await (await getBrowser()).createBrowserContext()
    try {
      const page = await context.newPage()
      // JavaScript désactivé et aucune requête réseau sortante (seules les
      // ressources data: intégrées) : un texte saisi ne peut ni exécuter de
      // script ni lire une URL interne
      await page.setJavaScriptEnabled(false)
      await page.setRequestInterception(true)
      page.on('request', (request) => {
        const url = request.url()
        if (url.startsWith('data:') || url === 'about:blank') void request.continue()
        else void request.abort('blockedbyclient')
      })
      await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
      return Buffer.from(await page.pdf(options))
    } finally {
      await context.close().catch(() => {})
    }
  } finally {
    release()
    scheduleIdleClose()
  }
}

// Formats papier utilisés par les documents (pouces, unité de Gotenberg)
const PAPER: Record<string, { width: number; height: number }> = {
  A4: { width: 8.27, height: 11.7 },
  A5: { width: 5.83, height: 8.27 },
}

async function renderWithGotenberg(baseUrl: string, html: string, options: PDFOptions): Promise<Buffer> {
  const form = new FormData()
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
  const paper = PAPER[String(options.format ?? 'A4').toUpperCase()] ?? PAPER.A4
  form.append('paperWidth', String(paper.width))
  form.append('paperHeight', String(paper.height))
  form.append('printBackground', String(options.printBackground ?? false))
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const value = options.margin?.[side]
    // Gotenberg exige une marge explicite (défaut 0,39 pouce sinon)
    form.append(`margin${side[0].toUpperCase()}${side.slice(1)}`, value === undefined ? '0' : String(value))
  }
  // Pied de page répété (numéros de page) : fichier footer.html, mêmes classes
  // pageNumber / totalPages que le footerTemplate de Chromium
  if (options.displayHeaderFooter && options.footerTemplate) {
    const footer = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;-webkit-print-color-adjust:exact;}</style></head><body>${options.footerTemplate}</body></html>`
    form.append('files', new Blob([footer], { type: 'text/html' }), 'footer.html')
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/forms/chromium/convert/html`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`Gotenberg a répondu ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Rendu PDF d'un document HTML entièrement intégré (images en data:).
 * Gotenberg si GOTENBERG_URL est défini, sinon Chromium local mutualisé.
 */
export async function renderPdf(html: string, options: PDFOptions): Promise<Buffer> {
  const gotenberg = process.env.GOTENBERG_URL
  return gotenberg ? renderWithGotenberg(gotenberg, html, options) : renderLocally(html, options)
}
