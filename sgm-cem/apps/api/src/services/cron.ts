import cron from 'node-cron'
import { PrismaClient } from '@prisma/client'
import { sendMonthlyStatement } from './notification'

const prisma = new PrismaClient()

/**
 * H4 — Relevé mensuel automatique.
 * Runs on the 1st of each month at 08:00.
 * Sends each active member a summary of their previous month's contributions.
 */
export function scheduleMonthlyCron(): void {
  // '0 8 1 * *' = At 08:00 on the 1st of every month
  cron.schedule('0 8 1 * *', async () => {
    console.log('[Cron] Starting monthly statement job...')
    try {
      await runMonthlyStatements()
      console.log('[Cron] Monthly statement job complete.')
    } catch (e) {
      console.error('[Cron] Monthly statement job failed:', e)
    }
  }, { timezone: 'Africa/Douala' })

  console.log('[Cron] Monthly statement job scheduled (1st of each month at 08:00 WAT)')
}

export async function runMonthlyStatements(): Promise<{ sent: number; errors: number }> {
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

      await sendMonthlyStatement({
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

      sent++
    } catch (e) {
      console.error(`[Cron] Error sending statement for member ${membre.id}:`, e)
      errors++
    }
  }

  return { sent, errors }
}
