import { alertTresoriers, sendMonthlyStatement } from './notification'
import { getPrisma } from '../lib/prisma'
import { checkLedger } from './fund-ledger.service'
import { logger } from '../lib/logger'

const prisma = getPrisma()

// Planification de ces tâches : jobs/scheduler.ts

/** Contrôle d'invariant du grand livre : alerte la trésorerie au premier écart. */
export async function runLedgerCheck(): Promise<number> {
  try {
    const result = await checkLedger(prisma)
    if (result.mismatches.length === 0) {
      logger.info({ confirmed: result.confirmedCount }, 'Grand livre des fonds : contrôle quotidien sans écart')
      return 0
    }
    logger.error({ mismatches: result.mismatches.slice(0, 20), count: result.mismatches.length }, 'Grand livre des fonds : écarts détectés')
    await alertTresoriers(
      'Écart dans le suivi des fonds',
      `${result.mismatches.length} contribution(s) dont l'emplacement ne correspond pas au grand livre. Contrôle : /api/funds/ledger/check`,
      { contributionIds: result.mismatches.slice(0, 50).map(m => m.contributionId) },
      { view: 'collecteurs' },
    )
    return result.mismatches.length
  } catch (e) {
    logger.error({ err: e }, 'Grand livre des fonds : contrôle quotidien impossible')
    return -1
  }
}

export async function runMonthlyStatements(): Promise<{ sent: number; notDelivered: number; errors: number }> {
  const now = new Date()
  // Previous month
  const year  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  const month = now.getMonth() === 0 ? 12 : now.getMonth() // 1-indexed
  const monthLabel = `${String(month).padStart(2, '0')}/${year}`

  const startOfMonth = new Date(year, month - 1, 1)
  const endOfMonth   = new Date(year, month, 0, 23, 59, 59, 999)

  const membres = await prisma.membre.findMany({
    where: { isActive: true },
    include: {
      user: { select: { id: true, phone: true, whatsappPhone: true, fullName: true } },
    },
  })

  let sent = 0
  let notDelivered = 0
  let errors = 0

  for (const membre of membres) {
    try {
      const contributions = await prisma.contribution.findMany({
        where: {
          membreId:  membre.id,
          createdAt: { gte: startOfMonth, lte: endOfMonth },
        },
        include: { rubrique: { select: { title: true } } },
        orderBy: { createdAt: 'asc' },
      })

      if (contributions.length === 0) continue

      const totalConfirmed = contributions
        .filter(c => c.statut === 'CONFIRME')
        .reduce((sum, c) => sum + c.montant, 0)

      const totalPending = contributions
        .filter(c => c.statut === 'EN_ATTENTE_CONFIRMATION')
        .reduce((sum, c) => sum + c.montant, 0)

      const phone = membre.user.whatsappPhone ?? membre.user.phone

      // Compté « envoyé » seulement si WhatsApp ou le SMS a abouti (la notification dans l'application part toujours)
      const delivered = await sendMonthlyStatement({
        userId:         membre.user.id,
        phone:          phone ?? null,
        memberName:     membre.user.fullName,
        month:          monthLabel,
        totalConfirmed,
        totalPending,
        contributions:  contributions.map(c => ({
          rubrique: c.rubrique?.title ?? 'N/A',
          montant:  c.montant,
          statut:   c.statut,
        })),
      })

      if (delivered) sent++
      else notDelivered++
    } catch (e) {
      console.error(`[Cron] Error sending statement for member ${membre.id}:`, e)
      errors++
    }
  }

  return { sent, notDelivered, errors }
}
