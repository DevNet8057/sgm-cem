// Durées de conservation annoncées sur la page /confidentialite (loi n° 2024/017),
// appliquées chaque nuit. Les montants et pièces comptables ne sont jamais supprimés :
// seules l'identité et les données techniques sont effacées à échéance.
import { getPrisma } from '../lib/prisma'
import { getConfigNumber } from './config.service'

const prisma = getPrisma()
const DAY_MS = 24 * 60 * 60 * 1000

function monthsAgo(now: Date, months: number): Date {
  const d = new Date(now)
  d.setMonth(d.getMonth() - months)
  return d
}

const months = (key: string, fallback: number) => Math.max(1, Math.trunc(getConfigNumber(key, fallback)))

export interface RetentionResult {
  notifications: number
  envois: number
  auditIp: number
  otpCodes: number
  sessions: number
  drafts: number
  donateurs: number
}

export async function runDataRetention(now = new Date()): Promise<RetentionResult> {
  const notificationsBefore = monthsAgo(now, months('RETENTION_NOTIFICATIONS_MOIS', 12))
  const auditIpBefore = monthsAgo(now, months('RETENTION_AUDIT_IP_MOIS', 12))
  const donateursBefore = monthsAgo(now, months('RETENTION_DONATEURS_MOIS', 36))
  // Codes et sessions expirés : gardés un jour pour l'analyse d'un incident récent
  const expiredBefore = new Date(now.getTime() - DAY_MS)

  const [notifications, envois, auditIp, otpCodes, sessions, abandoned, converted] = await prisma.$transaction([
    prisma.notification.deleteMany({ where: { createdAt: { lt: notificationsBefore } } }),
    // Journaux d'envoi (WhatsApp, SMS, e-mail) : même durée que les notifications
    prisma.envoi.deleteMany({ where: { createdAt: { lt: notificationsBefore } } }),
    // Journal d'audit conservé (opérations financières : 10 ans), adresse IP et navigateur effacés à 1 an
    prisma.auditLog.updateMany({
      where: { createdAt: { lt: auditIpBefore }, OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }] },
      data: { ipAddress: null, userAgent: null },
    }),
    prisma.otpCode.deleteMany({ where: { expiresAt: { lt: expiredBefore } } }),
    prisma.userSession.deleteMany({ where: { expiresAt: { lt: expiredBefore } } }),
    // Brouillon de don jamais payé et expiré : supprimé
    prisma.collecteDraft.deleteMany({ where: { statut: 'ACTIF', contributionId: null, expiresAt: { lt: now } } }),
    // Brouillon converti : la contribution porte le don, le brouillon perd l'identité
    prisma.collecteDraft.updateMany({
      where: { statut: 'CONVERTI', expiresAt: { lt: now }, OR: [{ nom: { not: null } }, { phone: { not: null } }, { email: { not: null } }] },
      data: { nom: null, phone: null, email: null },
    }),
  ])

  const donateurs = await anonymizeOldDonors(donateursBefore)
  return { notifications: notifications.count, envois: envois.count, auditIp: auditIp.count, otpCodes: otpCodes.count, sessions: sessions.count, drafts: abandoned.count + converted.count, donateurs }
}

/**
 * Donateurs des collectes publiques sans don depuis la date donnée : identité anonymisée,
 * dons conservés (pièces comptables). Le reçu déjà émis reste une pièce comptable.
 */
async function anonymizeOldDonors(before: Date): Promise<number> {
  const donors = await prisma.contributeurExterne.findMany({
    where: { createdAt: { lt: before }, NOT: { nom: 'Donateur anonymisé' }, contributions: { none: { createdAt: { gte: before } } } },
    select: { id: true },
  })
  for (const d of donors) {
    await prisma.$transaction([
      prisma.contributeurExterne.update({ where: { id: d.id }, data: { nom: 'Donateur anonymisé', phone: `anonymise-${d.id}`, email: null } }),
      prisma.contribution.updateMany({ where: { contributeurExterneId: d.id }, data: { mobileMoneyPhone: null } }),
    ])
  }
  return donors.length
}
