import cron from 'node-cron'
import { PrismaClient } from '@prisma/client'
import { getYeliiStatus } from '../services/yelii.service'
import { generateReceiptPDF } from '../services/receipt'
import { sendWhatsAppDocument, sendWhatsApp, alertTresoriers } from '../services/notification'
import { getConfigNumber } from '../services/config.service'

const prisma = new PrismaClient()

const STALE_AFTER_MS = 15 * 60 * 1000 // 15 minutes

/**
 * I8 — Job de réconciliation failsafe (section 11 Cas 2 du doc paiements).
 * Vérifie directement chez Yelii les contributions Mobile Money bloquées en
 * PROCESSING depuis plus de 15 minutes (cas où le webhook n'est jamais arrivé).
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
      modePaiement: { in: ['MTN_MOMO', 'ORANGE_MONEY'] },
      externalTransactionId: { not: null },
      createdAt: { lte: staleSince },
    },
    include: {
      membre: { include: { user: { select: { phone: true, whatsappPhone: true, fullName: true } } } },
      rubrique: { select: { title: true, code: true } },
    },
  })

  let confirmed = 0
  let failed = 0

  for (const contribution of stuck) {
    if (!contribution.externalTransactionId) continue

    const status = await getYeliiStatus(contribution.externalTransactionId)
    // 'unknown' = Yelii injoignable : on ne conclut RIEN, on revérifiera au prochain passage.
    if (status === 'processing' || status === 'unknown') continue // toujours en attente, on revérifiera au prochain passage

    const memberPhone = contribution.membre?.user.whatsappPhone ?? contribution.membre?.user.phone
    const memberName = contribution.membre?.user.fullName ?? 'Membre'
    const montantStr = contribution.montant.toLocaleString('fr-FR')

    if (status === 'success') {
      // Garde atomique : le polling de statut (payment-status.service) peut avoir déjà
      // confirmé cette contribution entre le findMany ci-dessus et cette écriture. On ne
      // transitionne que si elle est toujours EN_ATTENTE_CONFIRMATION, pour éviter un
      // second reçu PDF / second WhatsApp et un double comptage.
      const { count } = await prisma.contribution.updateMany({
        where: { id: contribution.id, statut: 'EN_ATTENTE_CONFIRMATION' },
        data: { statut: 'CONFIRME', confirmedAt: new Date(), paymentStatus: 'SUCCESS', localisationFonds: 'REMIS_TRESORIER' },
      })
      if (count === 0) {
        console.info(`[Reconciliation] ${contribution.externalTransactionId} — déjà traité par un autre chemin (polling), ignoré`)
        continue
      }

      const receiptUrl = await generateReceiptPDF(contribution.id)
      const msg = `CEM Melen - Paiement confirmé\nMembre: ${memberName}\nMontant: ${montantStr} FCFA\nRubrique: ${contribution.rubrique.title}\nMerci pour votre contribution !`
      if (memberPhone) {
        let sent = false
        if (receiptUrl) sent = await sendWhatsAppDocument(memberPhone, receiptUrl, msg)
        if (!sent) await sendWhatsApp(memberPhone, msg)
      }

      console.info(`[Reconciliation] ✅ ${contribution.externalTransactionId} — confirmé via polling`)
      confirmed++
    } else {
      // Même garde atomique que pour la branche succès : évite d'annuler une contribution
      // déjà confirmée entre-temps par le polling.
      const { count } = await prisma.contribution.updateMany({
        where: { id: contribution.id, statut: 'EN_ATTENTE_CONFIRMATION' },
        data: { statut: 'ANNULE', paymentStatus: 'FAILED' },
      })
      if (count === 0) {
        console.info(`[Reconciliation] ${contribution.externalTransactionId} — déjà traité par un autre chemin (polling), ignoré`)
        continue
      }

      if (memberPhone) {
        await sendWhatsApp(memberPhone, `CEM Melen - Paiement échoué\nMembre: ${memberName}\nMontant: ${montantStr} FCFA\nRubrique: ${contribution.rubrique.title}\nRéessayez ou contactez un collecteur.`)
      }

      console.info(`[Reconciliation] ❌ ${contribution.externalTransactionId} — échoué via polling`)
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
      'Paiements Mobile Money bloqués',
      `${veryStale.length} transaction(s) en PROCESSING depuis plus d'1h — vérification manuelle recommandée.`,
      { transactionIds: veryStale.map(c => c.externalTransactionId) },
      veryStale.length === 1 ? { view: 'contributions', id: veryStale[0].id } : undefined
    )
  }

  return { checked: stuck.length, confirmed, failed }
}
