// Lanceur dev : trouve des ports libres pour le web (3000+) et l'api (3001+),
// puis câble les deux (NEXT_PUBLIC_API_URL) avant de lancer les serveurs.
// Utile quand Docker occupe déjà 3000/3001 — voir DEPLOIEMENT_DOCKER.md.
import { createServer } from 'node:net'
import { concurrently } from 'concurrently'

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port)
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

if (webPort !== 3000 || apiPort !== 3001) {
  console.log('⚠️  Ports par défaut occupés (Docker ?) — ports alternatifs choisis.')
}
console.log(`🌐 Web : http://localhost:${webPort}`)
console.log(`🔌 API : http://localhost:${apiPort}/api\n`)

concurrently(
  [
    {
      command: 'pnpm --filter api dev',
      name: 'api',
      prefixColor: 'yellow',
      env: { PORT: String(apiPort) },
    },
    {
      command: 'pnpm --filter web dev',
      name: 'web',
      prefixColor: 'cyan',
      env: {
        PORT: String(webPort),
        NEXT_PUBLIC_API_URL: `http://localhost:${apiPort}/api`,
        NEXT_PUBLIC_APP_URL: `http://localhost:${webPort}`,
      },
    },
  ],
  { killOthers: ['failure', 'success'] },
)
