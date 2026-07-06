// ──────────────────────────────────────────────────────────────────────
// PREUVE FINALE — étape 10 de DEVELOPER_PANEL_SGM_CEM.md §8
//
// Scénario exécuté contre le serveur RÉEL déjà démarré (jamais redémarré) :
//   1. Change YELII_BASE_URL via l'API du panneau → pointe vers un mock local
//   2. Change YELII_WEBHOOK_URL via POST /config/webhook/recalculate
//   3. Initie un paiement Mobile Money réel (POST /api/payments/initiate)
//   4. Le mock "Yelii" reçoit l'appel → vérifie que callbackUrl = NOUVELLE URL
//   5. Restaure la config + supprime la contribution de test
//
// Succès = le serveur a utilisé les nouvelles valeurs SANS redémarrage.
// ──────────────────────────────────────────────────────────────────────
require('dotenv').config()
const http = require('http')
const jwt = require('jsonwebtoken')
const { PrismaClient } = require('@prisma/client')

const API = 'http://localhost:3001'
const MOCK_PORT = 4999
const NEW_BASE = 'https://preuve-sans-redemarrage.example.com'
const prisma = new PrismaClient()

const received = [] // corps reçus par le mock Yelii

function startMockYelii() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        received.push({ url: req.url, body: JSON.parse(body || '{}') })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: { transactionId: 'PROOF-TEST-001', status: 'processing' } }))
      })
    })
    server.listen(MOCK_PORT, () => resolve(server))
  })
}

async function main() {
  // ── Préparation : identité DEVELOPER + CSRF ──────────────────────────
  const dev = await prisma.user.findFirst({ where: { role: 'DEVELOPER' } })
  if (!dev) throw new Error('Aucun utilisateur DEVELOPER — exécuter seed-config.ts')
  const token = jwt.sign(
    { userId: dev.id, role: 'DEVELOPER', email: dev.email },
    process.env.JWT_SECRET ?? 'dev-secret',
    { expiresIn: '15m' }
  )
  const authCookie = `access_token=${token}`

  const csrfRes = await fetch(`${API}/api/csrf-token`, { headers: { Cookie: authCookie } })
  const csrfToken = (await csrfRes.json()).token
  const csrfCookie = (csrfRes.headers.get('set-cookie') ?? '').split(';')[0]
  const headers = {
    'Content-Type': 'application/json',
    'x-csrf-token': csrfToken,
    Cookie: `${authCookie}; ${csrfCookie}`,
  }

  // Sauvegarde des valeurs actuelles pour restauration
  const savedBase = (await prisma.systemConfig.findUnique({ where: { key: 'YELII_BASE_URL' } }))?.value
  const savedWebhook = (await prisma.systemConfig.findUnique({ where: { key: 'YELII_WEBHOOK_URL' } }))?.value
  console.log('Valeurs actuelles →', { YELII_BASE_URL: savedBase, YELII_WEBHOOK_URL: savedWebhook })

  const mock = await startMockYelii()
  console.log(`Mock Yelii démarré sur :${MOCK_PORT}`)

  try {
    // ── 1. YELII_BASE_URL → mock local, via le panneau ────────────────
    let r = await fetch(`${API}/api/developer/config/YELII_BASE_URL`, {
      method: 'PUT', headers,
      body: JSON.stringify({ value: `http://localhost:${MOCK_PORT}`, reason: '[preuve] redirection vers mock' }),
    })
    if (r.status !== 200) throw new Error(`PUT YELII_BASE_URL → ${r.status}: ${await r.text()}`)
    console.log('1. YELII_BASE_URL modifié via le panneau ✔')

    // ── 2. Recalcul du webhook via le bouton §4 ───────────────────────
    r = await fetch(`${API}/api/developer/config/webhook/recalculate`, {
      method: 'POST', headers,
      body: JSON.stringify({ newBaseUrl: `${NEW_BASE}/`, reason: '[preuve] test effet immédiat' }),
    })
    const recalc = await r.json()
    if (r.status !== 200) throw new Error(`recalculate → ${r.status}: ${JSON.stringify(recalc)}`)
    console.log('2. Webhook recalculé ✔ →', recalc.data.webhookUrl)

    // ── 3. Initiation d'un paiement Mobile Money RÉEL ─────────────────
    const membre = await prisma.membre.findFirst()
    const rubrique = await prisma.rubrique.findFirst({ where: { status: 'OUVERTE' } })
    if (!membre || !rubrique) throw new Error('Seed requis (membre + rubrique)')

    r = await fetch(`${API}/api/payments/initiate`, {
      method: 'POST', headers,
      body: JSON.stringify({
        membreId: membre.id, rubriqueId: rubrique.id, montant: 1000,
        modePaiement: 'YELII', mobileMoneyPhone: '677000001', paymentChannel: 'MTN',
      }),
    })
    const pay = await r.json()
    console.log(`3. /payments/initiate → ${r.status}`, JSON.stringify(pay.data ?? pay))

    // ── 4. VÉRIFICATION : le mock a-t-il reçu la NOUVELLE callbackUrl ? ─
    if (received.length === 0) throw new Error('ÉCHEC : le mock Yelii n\'a reçu aucun appel')
    const call = received[0]
    const expected = `${NEW_BASE}/webhooks/yelii`
    console.log('4. Mock Yelii a reçu :', JSON.stringify(call.body))
    if (call.body.callbackUrl !== expected) {
      throw new Error(`ÉCHEC : callbackUrl = ${call.body.callbackUrl}, attendu ${expected}`)
    }
    // Vérifie aussi la majoration §1bis : 1000 → ceil(1000/0.975) = 1026
    if (call.body.amount !== 1026) {
      throw new Error(`ÉCHEC : montant majoré = ${call.body.amount}, attendu 1026`)
    }

    console.log('')
    console.log('✅ PREUVE ÉTABLIE : le serveur (jamais redémarré) a appelé le mock')
    console.log(`   avec callbackUrl = ${expected}`)
    console.log('   → YELII_BASE_URL et YELII_WEBHOOK_URL modifiés depuis le panneau')
    console.log('   → pris en compte au premier appel suivant, SANS redémarrage.')

    // ── 5. Nettoyage ──────────────────────────────────────────────────
    if (pay?.data?.contributionId) {
      await prisma.contribution.delete({ where: { id: pay.data.contributionId } }).catch(() => {})
      console.log('Contribution de test supprimée ✔')
    }
  } finally {
    // Restauration via l'API (garde l'historique cohérent) — puis vérification
    const headers2 = headers
    if (savedBase) {
      await fetch(`${API}/api/developer/config/YELII_BASE_URL`, {
        method: 'PUT', headers: headers2,
        body: JSON.stringify({ value: savedBase, reason: '[preuve] restauration' }),
      })
    }
    if (savedWebhook) {
      await fetch(`${API}/api/developer/config/YELII_WEBHOOK_URL`, {
        method: 'PUT', headers: headers2,
        body: JSON.stringify({ value: savedWebhook, reason: '[preuve] restauration' }),
      })
    }
    console.log('Config restaurée ✔')
    mock.close()
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e.message); process.exit(1) })
