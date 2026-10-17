// Membres inactifs (lot 4.5 — EF-M03-07) : aucune contribution confirmée depuis
// inactivityMonthsThreshold mois (adhésion plus ancienne que ce délai).
import { getPrisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { notifyInApp } from './notification'

const prisma = getPrisma()

export interface InactiveMember {
  id: string; memberId: string; nom: string; groupe: string; phone: string | null; derniereContribution: Date | null
}

export async function findInactiveMembers(now = new Date()): Promise<{ thresholdMonths: number; since: Date; members: InactiveMember[] }> {
  const settings = await prisma.systemSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } })
  const since = new Date(now)
  since.setMonth(since.getMonth() - settings.inactivityMonthsThreshold)

  const [membres, last] = await Promise.all([
    prisma.membre.findMany({
      where: { isActive: true, user: { isActive: true }, dateAdhesion: { lt: since } },
      select: { id: true, memberId: true, groupe: true, phone: true, user: { select: { fullName: true } } },
      orderBy: { user: { fullName: 'asc' } },
    }),
    prisma.contribution.groupBy({ by: ['membreId'], where: { statut: 'CONFIRME', membreId: { not: null } }, _max: { createdAt: true } }),
  ])
  const lastById = new Map(last.map(l => [l.membreId!, l._max.createdAt]))
  const members = membres
    .map(m => ({ id: m.id, memberId: m.memberId, nom: m.user.fullName, groupe: m.groupe, phone: m.phone, derniereContribution: lastById.get(m.id) ?? null }))
    .filter(m => !m.derniereContribution || m.derniereContribution < since)
  return { thresholdMonths: settings.inactivityMonthsThreshold, since, members }
}

/** Signalement mensuel aux responsables (notification dans l'application). */
export async function runInactiveMembersReport(now = new Date()): Promise<number> {
  const { thresholdMonths, members } = await findInactiveMembers(now)
  if (members.length === 0) return 0
  const recipients = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['RESPONSABLE', 'ADJOINT_RESPONSABLE', 'ADMIN'] } }, select: { id: true },
  })
  await Promise.all(recipients.map(r => notifyInApp(r.id, 'Membres inactifs',
    `${members.length} membre(s) sans contribution confirmée depuis plus de ${thresholdMonths} mois. Consultez la liste dans Membres.`,
    'INFO', { kind: 'membres-inactifs', count: members.length }, { view: 'membres' })))
  logger.info({ count: members.length, recipients: recipients.length }, 'Signalement des membres inactifs envoyé')
  return members.length
}
