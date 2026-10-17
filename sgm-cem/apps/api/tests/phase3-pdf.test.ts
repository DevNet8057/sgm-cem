// Phase 3.2 — rendu PDF isolé : navigateur partagé, rendus simultanés limités,
// aucune requête réseau ; client Gotenberg (contrat vérifié sur un faux serveur).
import { describe, it, expect, afterAll } from 'vitest'
import http from 'http'
import fs from 'fs'
import type { AddressInfo } from 'net'
import { closePdfRenderer, renderPdf } from '../src/services/pdf-render'

// Chromium requis pour le rendu local (absent en CI : test ignoré, pas simulé)
const hasChromium = Boolean(process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH))

function listen(handler: http.RequestListener): Promise<{ url: string; close: () => void }> {
  const server = http.createServer(handler)
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() })
  }))
}

afterAll(async () => { await closePdfRenderer() })

describe('Rendu PDF', () => {
  it.runIf(hasChromium)('rendus simultanés : PDF valides, aucune requête réseau sortante', async () => {
    let hits = 0
    const spy = await listen((_req, res) => { hits++; res.end('x') })
    try {
      const html = (i: number) => `<html><body><h1>Reçu ${i}</h1><img src="${spy.url}/fuite.png"><link rel="stylesheet" href="${spy.url}/s.css"></body></html>`
      const started = Date.now()
      const pdfs = await Promise.all(Array.from({ length: 6 }, (_, i) => renderPdf(html(i), { format: 'A5', printBackground: true })))
      for (const pdf of pdfs) expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      expect(hits).toBe(0)
      expect(Date.now() - started).toBeLessThan(60_000)
    } finally {
      spy.close()
    }
  }, 90_000)

  it('Gotenberg : formulaire attendu, PDF renvoyé tel quel', async () => {
    let received = ''
    let path = ''
    const fake = await listen((req, res) => {
      path = req.url ?? ''
      const chunks: Buffer[] = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => { received = Buffer.concat(chunks).toString('latin1'); res.setHeader('Content-Type', 'application/pdf'); res.end('%PDF-1.7 faux') })
    })
    process.env.GOTENBERG_URL = fake.url
    try {
      const pdf = await renderPdf('<html><body>Bordereau</body></html>', { format: 'A4', printBackground: true, margin: { top: '10mm' } })
      expect(pdf.toString('latin1')).toBe('%PDF-1.7 faux')
      expect(path).toBe('/forms/chromium/convert/html')
      expect(received).toContain('filename="index.html"')
      expect(received).toContain('Bordereau')
      expect(received).toMatch(/name="paperWidth"\r\n\r\n8\.27/)
      expect(received).toMatch(/name="marginTop"\r\n\r\n10mm/)
      expect(received).toMatch(/name="printBackground"\r\n\r\ntrue/)
    } finally {
      delete process.env.GOTENBERG_URL
      fake.close()
    }
  })
})
