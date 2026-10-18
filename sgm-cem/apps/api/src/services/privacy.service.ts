// Droits des personnes (lot 4.6 — EF-M17-03/04, loi n° 2024/017) :
//  • accès et portabilité : chacun télécharge ses données (JSON lisible) ;
//  • effacement compatible avec la comptabilité : l'identité est anonymisée,
//    les montants, dates et rubriques des contributions sont conservés.
// Restent en l'état, pour obligation légale (à confirmer par l'avis juridique) :
// le journal d'audit (10 ans) et les reçus PDF déjà émis (pièces comptables).
import { randomBytes } from 'crypto'
import { getPrisma } from '../lib/prisma'
import { getConfigNumber } from './config.service'

const prisma = getPrisma()
const ANONYMOUS_DOMAIN = 'anonymise.invalid'

export function isAnonymized(email: string): boolean {
  return email.endsWith(`@${ANONYMOUS_DOMAIN}`)
}

/** Données personnelles d'un compte, dans un format lisible et réutilisable. */
export async function buildPersonalDataExport(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      memberId: true, email: true, phone: true, whatsappPhone: true, firstName: true, lastName: true, fullName: true,
      photoUrl: true, role: true, isActive: true, lastLoginAt: true, createdAt: true, updatedAt: true,
      membre: {
        select: {
          memberId: true, categorie: true, groupe: true, statut: true, profilFinancier: true, phone: true, email: true,
          adresse: true, profession: true, dateAdhesion: true, dateNaissance: true, notes: true, nomConjoint: true, isActive: true,
          contributions: {
            select: {
              createdAt: true, montant: true, modePaiement: true, statut: true, periodeLabel: true, referencePaiement: true,
              mobileMoneyPhone: true, confirmedAt: true, rubrique: { select: { code: true, title: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  })
  const [encaissements, notifications, connexions, appareils, actions] = await Promise.all([
    // Encaissements faits comme collecteur : sans l'identité des payeurs (données de tiers)
    prisma.contribution.findMany({
      where: { collecteurId: userId },
      select: { createdAt: true, montant: true, modePaiement: true, statut: true, rubrique: { select: { code: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.notification.findMany({ where: { userId }, select: { createdAt: true, title: true, body: true, isRead: true }, orderBy: { createdAt: 'desc' }, take: 1000 }),
    prisma.activitySession.findMany({ where: { userId }, select: { startedAt: true, lastSeenAt: true, endedAt: true }, orderBy: { startedAt: 'desc' }, take: 1000 }),
    prisma.pushSubscription.findMany({ where: { userId }, select: { createdAt: true, userAgent: true } }),
    prisma.auditLog.findMany({ where: { userId }, select: { createdAt: true, action: true, entityType: true, ipAddress: true }, orderBy: { createdAt: 'desc' }, take: 5000 }),
  ])
  const { membre, ...compte } = user
  return {
    generatedAt: new Date().toISOString(),
    source: 'SGM-CEM — Culte d\'Enfants de Melen',
    compte,
    ficheMembre: membre ? { ...membre, contributions: undefined } : null,
    contributions: (membre?.contributions ?? []).map(c => ({ ...c, rubrique: `${c.rubrique.code} — ${c.rubrique.title}` })),
    encaissementsCommeCollecteur: encaissements.map(e => ({ ...e, rubrique: e.rubrique.code })),
    notifications,
    sessionsApplication: connexions,
    appareilsNotificationsPush: appareils,
    journalDesActions: actions,
  }
}

export interface AnonymizationCheck {
  blockers: string[]
  lastActivityAt: Date
  availableFrom: Date
  delayMonths: number
}

/**
 * Conditions de l'anonymisation : compte déjà désactivé, aucun argent ni
 * opération en cours à son nom, et délai de conservation de l'identité écoulé
 * depuis la dernière activité (ANONYMISATION_DELAI_MOIS, 36 par défaut).
 */
export async function checkAnonymization(userId: string, now = new Date()): Promise<AnonymizationCheck> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, isActive: true, role: true, lastLoginAt: true, updatedAt: true, membre: { select: { id: true } } },
  })
  const [heldFunds, pendingTransfers, pendingAsCollector, pendingAsMember, lastContribution] = await Promise.all([
    prisma.contribution.count({ where: { detenteurId: userId, statut: 'CONFIRME', localisationFonds: { in: ['CHEZ_COLLECTEUR', 'CHEZ_RESPONSABLE', 'EN_TRANSIT'] } } }),
    prisma.fundsTransfer.count({ where: { status: 'PENDING_APPROVAL', OR: [{ senderId: userId }, { receiverId: userId }] } }),
    prisma.contribution.count({ where: { collecteurId: userId, statut: { in: ['EN_ATTENTE_CONFIRMATION', 'LITIGE'] } } }),
    user.membre ? prisma.contribution.count({ where: { membreId: user.membre.id, statut: { in: ['EN_ATTENTE_CONFIRMATION', 'LITIGE'] } } }) : 0,
    user.membre ? prisma.contribution.findFirst({ where: { membreId: user.membre.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }) : null,
  ])

  const delayMonths = Math.max(0, Math.trunc(getConfigNumber('ANONYMISATION_DELAI_MOIS', 36)))
  const dates = [user.updatedAt, user.lastLoginAt, lastContribution?.createdAt].filter((d): d is Date => d instanceof Date)
  const lastActivityAt = new Date(Math.max(...dates.map(d => d.getTime())))
  const availableFrom = new Date(lastActivityAt)
  availableFrom.setMonth(availableFrom.getMonth() + delayMonths)

  const blockers: string[] = []
  if (isAnonymized(user.email)) blockers.push('Ce compte est déjà anonymisé.')
  if (user.isActive) blockers.push('Désactivez d\'abord le compte.')
  if (user.role === 'DEVELOPER' || user.role === 'ADMIN') blockers.push('Un compte administrateur ou développeur doit d\'abord changer de rôle.')
  if (heldFunds > 0) blockers.push(`${heldFunds} contribution(s) encore détenue(s) par cette personne : faites d'abord remettre les fonds.`)
  if (pendingTransfers > 0) blockers.push(`${pendingTransfers} transfert(s) de fonds en attente.`)
  if (pendingAsCollector + pendingAsMember > 0) blockers.push(`${pendingAsCollector + pendingAsMember} paiement(s) en attente ou en litige.`)
  if (availableFrom > now) blockers.push(`Délai de conservation non écoulé : anonymisation possible à partir du ${availableFrom.toLocaleDateString('fr-FR', { timeZone: 'Africa/Douala' })}.`)
  return { blockers, lastActivityAt, availableFrom, delayMonths }
}

/**
 * Anonymise l'identité : nom, coordonnées, photo, profession, date de
 * naissance, notes ; sessions, notifications, appareils push et activité
 * supprimés. Les contributions gardent montant, date, rubrique et statut.
 * Irréversible.
 */
export async function anonymizeUser(userId: string): Promise<{ memberId: string }> {
  return prisma.$transaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { memberId: true, phone: true, membre: { select: { id: true, phone: true } } } })
    // Numéros sous leurs différentes écritures (+237…, 6XXXXXXXX)
    const phones = Array.from(new Set([user.phone, user.membre?.phone]
      .filter((p): p is string => Boolean(p))
      .flatMap(p => [p, p.replace(/\D/g, ''), p.replace(/\D/g, '').slice(-9), `+237${p.replace(/\D/g, '').slice(-9)}`])))

    await tx.user.update({
      where: { id: userId },
      data: {
        firstName: 'Personne', lastName: 'anonymisée', fullName: `Personne anonymisée (${user.memberId})`,
        email: `anonyme-${userId}@${ANONYMOUS_DOMAIN}`, phone: null, whatsappPhone: null, photoUrl: null,
        notificationToken: null, googleSub: null, isActive: false, mustChangePassword: true,
        // Mot de passe inutilisable (aucune empreinte ne correspond)
        passwordHash: `anonymise:${randomBytes(16).toString('hex')}`,
      },
    })
    if (user.membre) {
      await tx.membre.updateMany({ where: { coupleId: user.membre.id }, data: { coupleId: null } })
      await tx.membre.update({
        where: { id: user.membre.id },
        data: { phone: null, email: null, adresse: null, photoUrl: null, profession: null, dateNaissance: null, notes: null, nomConjoint: null, coupleId: null, isActive: false },
      })
      await tx.contribution.updateMany({ where: { membreId: user.membre.id }, data: { mobileMoneyPhone: null } })
    }
    await tx.userSession.deleteMany({ where: { userId } })
    await tx.pushSubscription.deleteMany({ where: { userId } })
    await tx.notification.deleteMany({ where: { userId } })
    await tx.activitySession.deleteMany({ where: { userId } })
    if (phones.length > 0) {
      await tx.otpCode.deleteMany({ where: { phone: { in: phones } } })
      await tx.paymentAttempt.updateMany({ where: { phone: { in: phones } }, data: { phone: null } })
    }
    return { memberId: user.memberId }
  })
}
