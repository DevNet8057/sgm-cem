// Tâches planifiées (lot 3.1, ADR-001) : un seul catalogue, deux moteurs.
//  • Redis disponible (REDIS_URL) : planificateurs BullMQ — chaque échéance est
//    exécutée UNE fois, quel que soit le nombre de processus (API, worker).
//  • Sans Redis : node-cron dans le processus courant (comportement historique).
// Le processus qui exécute les tâches est choisi au déploiement : l'API par
// défaut, ou le worker (`node dist/worker.js`) avec RUN_SCHEDULED_JOBS=false sur l'API.
import cron from 'node-cron'
import { Queue, Worker, type ConnectionOptions } from 'bullmq'
import IORedis from 'ioredis'
import { logger } from '../lib/logger'
import { getConfigNumber } from '../services/config.service'
import { runPaymentReconciliation } from './payment-reconciliation'
import { runLedgerCheck, runMonthlyStatements } from '../services/cron'
import { pruneExpiredActivity } from '../services/activity-write.service'
import { runDailyReminders, runTransferReminders } from '../services/reminders.service'

const QUEUE = 'sgm-maintenance'
const TZ = 'Africa/Douala'

type Repeat = { every: number } | { pattern: string; tz: string }
interface ScheduledJob { name: string; label: string; repeat: Repeat; run: (ctx: JobContext) => Promise<unknown> }
interface JobContext { lastRunAt: () => Promise<number>; markRun: (at: number) => Promise<void> }

// Réconciliation : la planification tourne chaque minute et le travail réel ne
// part que si RECONCILIATION_INTERVAL_MINUTES est écoulé (réglable sans redémarrage)
async function reconciliationTick(ctx: JobContext): Promise<unknown> {
  const intervalMinutes = Math.max(1, getConfigNumber('RECONCILIATION_INTERVAL_MINUTES', 10))
  if (Date.now() - (await ctx.lastRunAt()) < intervalMinutes * 60_000) return 'en attente'
  await ctx.markRun(Date.now())
  const result = await runPaymentReconciliation()
  logger.info(result, 'Réconciliation des paiements terminée')
  return result
}

export const SCHEDULED_JOBS: ScheduledJob[] = [
  { name: 'paiements-reconciliation', label: 'Réconciliation des paiements', repeat: { every: 60_000 }, run: reconciliationTick },
  { name: 'grand-livre-controle', label: 'Contrôle quotidien du grand livre', repeat: { pattern: '10 6 * * *', tz: TZ }, run: () => runLedgerCheck() },
  { name: 'releves-mensuels', label: 'Relevés mensuels', repeat: { pattern: '0 8 1 * *', tz: TZ }, run: () => runMonthlyStatements() },
  { name: 'relances-quotidiennes', label: 'Relances : paiements à confirmer, fonds à remettre', repeat: { pattern: '0 9 * * *', tz: TZ }, run: () => runDailyReminders() },
  { name: 'relances-transferts', label: 'Relances : transferts en attente', repeat: { pattern: '20 * * * *', tz: TZ }, run: () => runTransferReminders() },
  { name: 'activite-retention', label: "Purge des données d'activité", repeat: { pattern: '30 3 * * *', tz: TZ }, run: () => pruneExpiredActivity() },
]

export interface SchedulerHandle { engine: 'bullmq' | 'local'; stop: () => Promise<void> }

export async function startScheduledJobs(): Promise<SchedulerHandle> {
  const url = process.env.REDIS_URL
  if (!url) return startLocal()
  try {
    return await startBullmq(url)
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Redis indisponible : tâches planifiées exécutées localement')
    return startLocal()
  }
}

async function startBullmq(url: string): Promise<SchedulerHandle> {
  const redis = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true })
  await redis.connect()
  const connection = redis as unknown as ConnectionOptions
  const queue = new Queue(QUEUE, { connection })

  // Catalogue = source de vérité : planificateurs créés ou mis à jour, anciens retirés
  const wanted = new Set(SCHEDULED_JOBS.map(j => j.name))
  for (const existing of await queue.getJobSchedulers()) {
    if (existing.key && !wanted.has(existing.key)) await queue.removeJobScheduler(existing.key)
  }
  for (const job of SCHEDULED_JOBS) {
    await queue.upsertJobScheduler(job.name, job.repeat, {
      name: job.name,
      opts: { removeOnComplete: 100, removeOnFail: 500, attempts: 1 },
    })
  }

  const contextFor = (name: string): JobContext => ({
    lastRunAt: async () => Number(await redis.get(`sgm:jobs:${name}:last`) ?? 0),
    markRun: async at => { await redis.set(`sgm:jobs:${name}:last`, String(at)) },
  })
  const worker = new Worker(QUEUE, async job => {
    const def = SCHEDULED_JOBS.find(j => j.name === job.name)
    if (!def) return 'inconnue'
    return def.run(contextFor(def.name))
  }, { connection, concurrency: 1 })
  worker.on('failed', (job, err) => logger.error({ job: job?.name, err: err.message }, 'Tâche planifiée en échec'))

  logger.info({ jobs: SCHEDULED_JOBS.map(j => j.name) }, 'Tâches planifiées : BullMQ (une exécution par échéance)')
  return {
    engine: 'bullmq',
    stop: async () => { await worker.close(); await queue.close(); await redis.quit() },
  }
}

function startLocal(): SchedulerHandle {
  const lastRun = new Map<string, number>()
  const tasks = SCHEDULED_JOBS.map(job => {
    const ctx: JobContext = {
      lastRunAt: async () => lastRun.get(job.name) ?? 0,
      markRun: async at => { lastRun.set(job.name, at) },
    }
    const exec = () => { job.run(ctx).catch(err => logger.error({ job: job.name, err: (err as Error).message }, 'Tâche planifiée en échec')) }
    if ('every' in job.repeat) {
      const timer = setInterval(exec, job.repeat.every)
      timer.unref()
      return { stop: () => clearInterval(timer) }
    }
    const task = cron.schedule(job.repeat.pattern, exec, { timezone: job.repeat.tz })
    return { stop: () => { task.stop() } }
  })
  logger.info({ jobs: SCHEDULED_JOBS.map(j => j.name) }, 'Tâches planifiées : exécution locale (sans Redis)')
  return { engine: 'local', stop: async () => { tasks.forEach(t => t.stop()) } }
}
