// Audit d'accessibilité (axe-core, WCAG 2.1 A/AA) des écrans clés, à 360 px.
// Échoue (code 1) dès qu'une règle « serious » ou « critical » est violée.
//
// Prérequis : API et web démarrés, base avec les comptes de démonstration.
// Variables : A11Y_BASE_URL (défaut http://localhost:3000), A11Y_PASSWORD
// (mot de passe des comptes de démo), A11Y_ADMIN_EMAIL / A11Y_ADMIN_PASSWORD,
// CHROMIUM_PATH (facultatif : navigateur déjà installé).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'

const require = createRequire(import.meta.url)
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const BASE = process.env.A11Y_BASE_URL ?? 'http://localhost:3000'
const DEMO = process.env.A11Y_PASSWORD

const ACCOUNTS = [
  { email: 'martine.eloundou@gmail.com', password: DEMO, views: ['dashboard', 'rubriques', 'mon-profil'] },
  { email: 'collecteur.temple@cem-melen.cm', password: DEMO, views: ['dashboard', 'contributions', 'collecteurs', 'validations', 'transfer-validations'] },
  { email: 'tresorier@cem-melen.cm', password: DEMO, views: ['dashboard', 'collecteurs', 'litiges', 'rapports', 'statistiques'] },
  { email: process.env.A11Y_ADMIN_EMAIL ?? 'admin@cem-melen.cm', password: process.env.A11Y_ADMIN_PASSWORD, views: ['utilisateurs', 'membres', 'rubriques', 'parametres', 'collectes-publiques', 'journal', 'ged', 'prestations'] },
]

let failures = 0

async function audit(page, label) {
  await page.addScriptTag({ content: AXE })
  const violations = await page.evaluate(async () => {
    const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
    return res.violations
      .filter(v => v.impact === 'serious' || v.impact === 'critical')
      .map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }))
  })
  failures += violations.length
  console.log(`${violations.length ? '✗' : '✓'} ${label}`)
  for (const v of violations) console.log(`    [${v.impact}] ${v.id} — ${v.targets.join(' | ')}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
try {
  const anon = await browser.newPage({ viewport: { width: 360, height: 800 } })
  await anon.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await audit(anon, 'Connexion')
  await anon.goto(`${BASE}/confidentialite`, { waitUntil: 'networkidle' })
  await audit(anon, 'Confidentialité')

  for (const account of ACCOUNTS) {
    if (!account.password) { console.log(`- ${account.email} ignoré (mot de passe non fourni)`); continue }
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.fill('input[type="email"]', account.email)
    await page.fill('input[type="password"]', account.password)
    await page.keyboard.press('Enter')
    await page.waitForURL(/dashboard/, { timeout: 20000 })
    for (const view of account.views) {
      await page.goto(`${BASE}/dashboard/${view}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1200)
      await audit(page, `${account.email} → ${view}`)
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}

console.log(failures ? `\n${failures} règle(s) d'accessibilité en échec` : '\nAucune violation sérieuse ou critique')
process.exit(failures ? 1 : 0)
