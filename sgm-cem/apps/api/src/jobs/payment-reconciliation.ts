import cron from 'node-cron'
import { PrismaClient } from '@prisma/client'
import { alertTresoriers } from '../services/notification'
import { getConfigNumber } from '../services/config.service'
import { CONTRIBUTION_SYNC_SELECT, syncPaymentContributionStatus } from '../services/payment-status.service'

const prisma = new PrismaClient()

const STALE_AFTER_MS = 15 * 60 * 1000 // 15 minutes

/**
 * I8 — Job de réconciliation failsafe (section 11 Cas 2 du doc paiements).
 * Vérifie les contributions Mobile Money et carte bloquées en PROCESSING
 * depuis plus de 15 minutes (cas où le webhook n'est jamais arrivé).
 *
 * Fréquence DYNAMIQUE (panneau développeur, section E) : le cron tourne chaque
 * minute et n'exécute le job que si RECONCILIATION_INTERVAL_MINUTES se sont
 * écoulées depuis la dernière exécution — un changement de fréquence prend
 * effet sans redémarrage.
 */
let lastRunAt = 0

export function schedulePaymentReconciliation(): void {
  cron.schedule('* * * * *', async () => {
    const intervalMinutes = Math.max(1, getConfigNumber('RECONCILIATION_INTERVAL_MINUTES', 10))
    if (Date.now() - lastRunAt < intervalMinutes * 60_000) return
    lastRunAt = Date.now()

    console.log(`[Cron] Starting payment reconciliation job (intervalle ${intervalMinutes} min)...`)
    try {
      const result = await runPaymentReconciliation()
      console.log(`[Cron] Payment reconciliation complete: ${result.checked} checked, ${result.confirmed} confirmed, ${result.failed} failed.`)
    } catch (e) {
      console.error('[Cron] Payment reconciliation job failed:', e)
    }
  })

  console.log('[Cron] Payment reconciliation job scheduled (intervalle dynamique, défaut 10 min)')
}

export async function runPaymentReconciliation(): Promise<{ checked: number; confirmed: number; failed: number }> {
  const staleSince = new Date(Date.now() - STALE_AFTER_MS)

  const stuck = await prisma.contribution.findMany({
    where: {
      paymentStatus: 'PROCESSING',
      modePaiement: { in: ['MTN_MOMO', 'ORANGE_MONEY', 'CARTE_VISA'] },
      externalTransactionId: { not: null },
      createdAt: { lte: staleSince },
    },
    select: {
      ...CONTRIBUTION_SYNC_SELECT,
      createdAt: true,
    },
  })

  let confirmed = 0
  let failed = 0

  for (const contribution of stuck) {
    const result = await syncPaymentContributionStatus(contribution)
    if (contribution.statut !== 'CONFIRME' && result.statut === 'CONFIRME') {
      confirmed++
    } else if (contribution.statut !== 'ANNULE' && result.statut === 'ANNULE') {
      failed++
    }
  }

  // Alerte Trésoriers si des transactions restent bloquées après 1h (webhook ET polling silencieux)
  // veryStale vient de `stuck` (findMany ci-dessus) : chaque élément EST déjà une
  // Contribution complète avec son .id — pas besoin de le "remonter" depuis
  // transactionIds, il était disponible dès le départ, juste jamais capturé.
  // Cible cliquable uniquement si une seule transaction est bloquée : au-delà,
  // il n'y a pas UNE contribution à ouvrir, `data.transactionIds` reste la
  // liste informative (contexte non structurel, comme prévu pour `data`).
  const veryStale = stuck.filter(c => Date.now() - c.createdAt.getTime() > 60 * 60 * 1000)
  if (veryStale.length > 0) {
    await alertTresoriers(
      'Paiements digitaux bloqués',
      `${veryStale.length} paiement(s) Mobile Money/carte en PROCESSING depuis plus d'1h — vérification manuelle recommandée.`,
      { transactionIds: veryStale.map(c => c.externalTransactionId) },
      veryStale.length === 1 ? { view: 'contributions', id: veryStale[0].id } : undefined
    )
  }

  return { checked: stuck.length, confirmed, failed }
}
