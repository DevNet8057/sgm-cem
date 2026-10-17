// Phase 3.1 — catalogue unique des tâches planifiées ; sans Redis, exécution
// locale (comportement historique). L'unicité d'exécution avec BullMQ est
// prouvée en conditions réelles (deux workers simultanés, voir AVANCEMENT).
import { describe, it, expect } from 'vitest'
import cron from 'node-cron'
import { SCHEDULED_JOBS, startScheduledJobs } from '../src/jobs/scheduler'

describe('Tâches planifiées', () => {
  it('catalogue : noms uniques, échéances valides', () => {
    const names = SCHEDULED_JOBS.map(j => j.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(expect.arrayContaining(['paiements-reconciliation', 'grand-livre-controle', 'releves-mensuels', 'activite-retention']))
    for (const job of SCHEDULED_JOBS) {
      if ('pattern' in job.repeat) expect(cron.validate(job.repeat.pattern)).toBe(true)
      else expect(job.repeat.every).toBeGreaterThanOrEqual(60_000)
    }
  })

  it('sans Redis : moteur local, arrêt propre', async () => {
    const saved = process.env.REDIS_URL
    delete process.env.REDIS_URL
    try {
      const handle = await startScheduledJobs()
      expect(handle.engine).toBe('local')
      await handle.stop()
    } finally {
      if (saved) process.env.REDIS_URL = saved
    }
  })
})
