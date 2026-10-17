// Conservation des documents de la GED (lot 4.7 — EF-M11-04) : avertissement
// 30 jours avant l'échéance (auteur, responsable de la commission), puis
// ARCHIVAGE à l'échéance. Jamais de suppression automatique : supprimer reste
// une décision humaine (niveau 3, journalisée).
import { getPrisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { notifyInApp } from './notification'

const prisma = getPrisma()
const NOTICE_DAYS = 30

export async function runGedRetention(now = new Date()): Promise<{ avertis: number; archives: number }> {
  const horizon = new Date(now.getTime() + NOTICE_DAYS * 24 * 60 * 60 * 1000)
  const soon = await prisma.document.findMany({
    where: { statut: { not: 'ARCHIVE' }, expiryNotifiedAt: null, expiresAt: { gt: now, lte: horizon } },
    select: { id: true, titre: true, expiresAt: true, uploadedById: true, commission: { select: { responsableId: true, nom: true } } },
  })
  let avertis = 0
  for (const doc of soon) {
    // Réservation : une seule notification, même si la tâche tourne deux fois
    const claimed = await prisma.document.updateMany({ where: { id: doc.id, expiryNotifiedAt: null }, data: { expiryNotifiedAt: now } })
    if (claimed.count !== 1) continue
    const date = doc.expiresAt!.toLocaleDateString('fr-FR', { timeZone: 'Africa/Douala' })
    const recipients = new Set([doc.uploadedById, doc.commission.responsableId])
    await Promise.all([...recipients].map(userId => notifyInApp(userId, 'Document bientôt archivé',
      `« ${doc.titre} » (${doc.commission.nom}) atteint sa durée de conservation le ${date} : il sera alors archivé.`,
      'INFO', { kind: 'ged-conservation', documentId: doc.id }, { view: 'ged', id: doc.id })))
    avertis++
  }
  const archived = await prisma.document.updateMany({ where: { statut: { not: 'ARCHIVE' }, expiresAt: { lte: now } }, data: { statut: 'ARCHIVE' } })
  if (avertis || archived.count) logger.info({ avertis, archives: archived.count }, 'GED : conservation appliquée')
  return { avertis, archives: archived.count }
}
