// Processus worker (lot 3.1) : exécute les tâches planifiées hors du processus
// HTTP. Même image que l'API : `node dist/worker.js` (l'API démarre alors avec
// RUN_SCHEDULED_JOBS=false). Les migrations restent faites par l'API au démarrage.
import 'dotenv/config'
import './lib/zod-locale'
import { logger, applyLogLevel } from './lib/logger'
import { initErrorTracking } from './lib/error-tracking'
import { assertEncryptionKeyForProduction } from './lib/secret-box'
import { getConfig, loadConfigCache, startConfigRefresh } from './services/config.service'
import { startScheduledJobs } from './jobs/scheduler'
import { disconnectPrisma } from './lib/prisma'

async function main(): Promise<void> {
  initErrorTracking()
  assertEncryptionKeyForProduction()
  await loadConfigCache()
  applyLogLevel(getConfig('LOG_LEVEL'))
  startConfigRefresh()
  const scheduler = await startScheduledJobs()
  logger.info({ engine: scheduler.engine }, 'Worker SGM-CEM démarré')

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Arrêt du worker')
    await scheduler.stop()
    await disconnectPrisma()
    process.exit(0)
  }
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  process.on('SIGINT', () => { void shutdown('SIGINT') })
}

main().catch(err => {
  logger.fatal({ err }, 'Worker : démarrage impossible')
  process.exit(1)
})
