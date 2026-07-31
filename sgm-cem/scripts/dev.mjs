// Lanceur dev : trouve des ports libres pour le web (3000+) et l'api (3001+),
// câble les deux (NEXT_PUBLIC_API_URL) puis lance les serveurs en écoute sur
// HOST (0.0.0.0 par défaut) pour qu'ils soient joignables depuis le réseau local.
// Utile quand Docker occupe déjà 3000/3001 — voir DEPLOIEMENT_DOCKER.md.
import { createServer } from 'node:net'
import os from 'node:os'
import { concurrently } from 'concurrently'

const HOST = process.env.HOST ?? '0.0.0.0'

// Adresse IPv4 non-interne de la machine, utilisable par les autres appareils
// du réseau local (téléphone, autre PC…). Ignore les interfaces virtuelles
// (VPN, WSL, Hyper-V) qui ne sont pas joignables depuis l'extérieur.
function getLanIp() {
  const nets = os.networkInterfaces()
  const virtual = /vEthernet|Loopback|Virtual|Docker|WSL|VPN/i

  for (const [name, addrs] of Object.entries(nets)) {
    if (virtual.test(name)) continue
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  // Repli : n'importe quelle IPv4 non interne si rien de plus sûr n'a été trouvé
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return null
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, HOST)
  })
}

async function findFreePort(start, exclude = []) {
  for (let port = start; port < start + 100; port++) {
    if (exclude.includes(port)) continue
    if (await isPortFree(port)) return port
  }
  throw new Error(`Aucun port libre trouvé à partir de ${start}`)
}

const webPort = await findFreePort(Number(process.env.WEB_PORT ?? 3000))
const apiPort = await findFreePort(Number(process.env.API_PORT ?? 3001), [webPort])
const lanIp = getLanIp()

if (webPort !== 3000 || apiPort !== 3001) {
  console.log('⚠️  Ports par défaut occupés (Docker ?) — ports alternatifs choisis.')
}

console.log(`🌐 Web : http://localhost:${webPort}`)
if (lanIp) console.log(`        http://${lanIp}:${webPort}  (réseau local)`)
console.log(`🔌 API : http://localhost:${apiPort}/api`)
if (lanIp) console.log(`        http://${lanIp}:${apiPort}/api  (réseau local)`)
if (!lanIp) console.log('⚠️  Aucune IP réseau local détectée — accessible uniquement en localhost.')
console.log()

// NEXT_PUBLIC_API_URL n'est PAS fixé ici volontairement : apps/web/src/lib/api.ts
// (getBaseURL) retombe sur `http://${window.location.hostname}:${apiPort}/api`
// quand la variable est absente — ça s'adapte automatiquement à l'hôte utilisé
// par le navigateur (localhost OU l'IP LAN). Fixer une valeur en dur ici casse
// l'autre : cookies SameSite=Lax (CSRF, session) non renvoyés si la page est
// chargée sur un hôte et l'API appelée sur un autre (origines différentes).
concurrently(
  [
    {
      command: 'pnpm --filter api dev',
      name: 'api',
      prefixColor: 'yellow',
      env: { PORT: String(apiPort), HOST },
    },
    {
      command: 'pnpm --filter web dev',
      name: 'web',
      prefixColor: 'cyan',
      env: { PORT: String(webPort), HOST },
    },
  ],
  { killOthers: ['failure', 'success'] },
)
