import puppeteer, { type PDFOptions } from 'puppeteer'
import fs from 'fs'

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

/**
 * Rendu PDF durci : JavaScript désactivé et aucune requête réseau sortante
 * (seules les ressources data: intégrées sont autorisées). Un texte saisi par
 * un utilisateur ne peut donc ni exécuter de script ni lire une URL interne.
 */
export async function renderPdf(html: string, options: PDFOptions): Promise<Buffer> {
  const executablePath = resolveBrowserExecutable()
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(executablePath ? { executablePath } : {}),
  })
  try {
    const page = await browser.newPage()
    await page.setJavaScriptEnabled(false)
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      const url = request.url()
      if (url.startsWith('data:') || url === 'about:blank') void request.continue()
      else void request.abort('blockedbyclient')
    })
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    const pdf = await page.pdf(options)
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}
