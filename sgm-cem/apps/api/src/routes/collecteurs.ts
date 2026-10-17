import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { getPrisma } from '../lib/prisma'
import { netLocationGroups } from '../services/refund.service'

const router = Router()
const prisma = getPrisma()

router.get('/', authenticate, requireLevel(2), async (req, res) => {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } })
  const maxRetentionDays = settings?.maxFundsRetentionDays ?? 7
  const retentionLimit = new Date(Date.now() - maxRetentionDays * 24 * 60 * 60 * 1000)

  const myRole = req.user?.role
  const myUserId = req.user?.userId

  const [contributions, rawFlowGroups, modeGroups, users] = await Promise.all([
    prisma.contribution.findMany({
      // Fonds détenus par des personnes (collecteurs, responsables) ou en route ;
      // chacun voit ce qu'il détient, la trésorerie et l'administration voient tout
      where: {
        statut: 'CONFIRME',
        localisationFonds: { in: ['CHEZ_COLLECTEUR', 'CHEZ_RESPONSABLE', 'EN_TRANSIT'] },
        ...(['TRESORIER', 'ADMIN', 'DEVELOPER'].includes(myRole ?? '') ? {} : { detenteurId: myUserId }),
      },
      include: {
        collecteur: { select: { id: true, fullName: true, email: true, role: true } },
        detenteur: { select: { id: true, fullName: true, email: true, role: true } },
        membre: { include: { user: { select: { fullName: true } } } },
        contributeurExterne: { select: { nom: true } },
        rubrique: { select: { code: true, title: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.contribution.groupBy({
      by: ['localisationFonds'],
      where: { statut: 'CONFIRME' },
      _sum: { montant: true },
      _count: true,
    }),
    prisma.contribution.groupBy({
      by: ['modePaiement'],
      where: { statut: 'CONFIRME' },
      _sum: { montant: true },
    }),
    prisma.user.findMany({
      where: { isActive: true, role: { in: ['TRESORIER', 'COLLECTEUR'] } },
      select: { id: true, fullName: true, email: true, role: true },
      orderBy: { role: 'asc' },
    }),
  ])

  // Argent rendu (remboursements exécutés) déduit de l'emplacement d'où il est sorti
  const flowGroups = await netLocationGroups(rawFlowGroups)

  const eligibleRecipients = users
    .filter(u => myRole !== 'COLLECTEUR' || u.id !== myUserId)
    .map(u => ({ id: u.id, fullName: u.fullName, email: u.email, role: u.role }))

  // Qui a validé (confirmé) chacune de ces contributions — confirmedById n'est
  // pas une relation Prisma (simple string), résolution manuelle en un seul aller.
  const confirmerIds = Array.from(new Set(
    contributions.map(c => c.confirmedById).filter((id): id is string => Boolean(id))
  ))
  const confirmers = confirmerIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: confirmerIds } }, select: { id: true, fullName: true } })
    : []
  const confirmerNameById = new Map(confirmers.map(u => [u.id, u.fullName]))

  // Regroupement par DÉTENTEUR (qui a l'argent), et non par auteur de l'encaissement
  const byCollector = new Map<string, {
    detenteurId: string
    detenteurName: string
    detenteurEmail?: string
    detenteurRole?: string
    totalDetenu: number
    totalEnTransit: number
    totalARemettre: number
    nbContributions: number
    nbEnRetard: number
    oldestContributionAt?: Date
    lastValidatedByName?: string
    lastValidatedAt?: Date
  }>()

  for (const contribution of contributions) {
    const key = contribution.detenteurId ?? 'sans-detenteur'
    const row = byCollector.get(key) ?? {
      detenteurId: key,
      detenteurName: contribution.detenteur?.fullName ?? 'Détenteur non renseigné',
      detenteurEmail: contribution.detenteur?.email,
      detenteurRole: contribution.detenteur?.role,
      totalDetenu: 0,
      totalEnTransit: 0,
      totalARemettre: 0,
      nbContributions: 0,
      nbEnRetard: 0,
      oldestContributionAt: contribution.createdAt,
      lastValidatedByName: undefined,
      lastValidatedAt: undefined,
    }

    if (contribution.localisationFonds !== 'EN_TRANSIT') row.totalDetenu += contribution.montant
    if (contribution.localisationFonds === 'EN_TRANSIT') row.totalEnTransit += contribution.montant
    row.totalARemettre += contribution.montant
    row.nbContributions += 1
    if (contribution.createdAt < retentionLimit) row.nbEnRetard += 1
    if (!row.oldestContributionAt || contribution.createdAt < row.oldestContributionAt) {
      row.oldestContributionAt = contribution.createdAt
    }
    const validatedAt = contribution.confirmedAt ?? contribution.createdAt
    if (contribution.confirmedById && (!row.lastValidatedAt || validatedAt > row.lastValidatedAt)) {
      row.lastValidatedByName = confirmerNameById.get(contribution.confirmedById)
      row.lastValidatedAt = validatedAt
    }
    byCollector.set(key, row)
  }

  const summary = Array.from(byCollector.values()).sort((a, b) => b.totalARemettre - a.totalARemettre)
  const totalARemettre = summary.reduce((sum, item) => sum + item.totalARemettre, 0)
  const totalEnRetard = summary.reduce((sum, item) => sum + item.nbEnRetard, 0)
  // Répartition par canal — l'argent Mobile Money/Carte est crédité directement
  // chez le trésorier (voir webhooks Yelii/CinetPay), il ne transite jamais par
  // un collecteur. Seules les espèces suivent le chemin collecteur → transit → trésorier.
  const ELECTRONIC_MODES = ['MTN_MOMO', 'ORANGE_MONEY', 'YELII', 'CARTE_VISA']
  const electroniqueTotal = modeGroups
    .filter(g => ELECTRONIC_MODES.includes(g.modePaiement))
    .reduce((sum, g) => sum + (g._sum.montant ?? 0), 0)
  const especesTotal = modeGroups
    .filter(g => !ELECTRONIC_MODES.includes(g.modePaiement))
    .reduce((sum, g) => sum + (g._sum.montant ?? 0), 0)

  const flow = {
    chezCollecteur: amountFor(flowGroups, 'CHEZ_COLLECTEUR'),
    enTransit: amountFor(flowGroups, 'EN_TRANSIT'),
    chezResponsable: amountFor(flowGroups, 'CHEZ_RESPONSABLE'),
    remisTresorier: amountFor(flowGroups, 'REMIS_TRESORIER'),
    enCaisse: amountFor(flowGroups, 'EN_CAISSE'),
    portefeuilleElectronique: amountFor(flowGroups, 'PORTEFEUILLE_ELECTRONIQUE'),
    enBanque: amountFor(flowGroups, 'EN_BANQUE'),
    totalConfirme: flowGroups.reduce((sum, item) => sum + (item._sum.montant ?? 0), 0),
    especesTotal,
    electroniqueTotal,
  }

  res.json({
    success: true,
    data: {
      summary,
      contributions,
      totals: {
        totalARemettre,
        totalContributions: contributions.length,
        totalEnRetard,
        maxRetentionDays,
      },
      flow,
      eligibleRecipients,
      myRole,
      myUserId,
    }
  })
})

router.get('/eligible-for-declaration', authenticate, requireLevel(1), async (_req, res) => {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { in: ['COLLECTEUR', 'TRESORIER'] },
    },
    select: { id: true, fullName: true, role: true },
    orderBy: [
      { fullName: 'asc' },
      { role: 'asc' },
    ],
  })

  res.json({ success: true, data: users })
})

// Décision du Bureau (17/10/2026) — circuit officiel seul : les fonds se
// déplacent uniquement par /api/funds/transfer (envoi → réception confirmée
// par le destinataire → dépôt bancaire). Les anciens raccourcis « Vers caisse /
// Vers banque » (PATCH /transfer) et « Réceptionner » (PATCH /claim) sont
// retirés : ils permettaient de déplacer ou de s'attribuer des fonds sans
// accord du détenteur (preuve P3 de l'audit).
router.patch(['/transfer', '/claim'], authenticate, () => {
  throw new AppError('GONE', 'Opération retirée : utilisez le transfert de fonds (Trésorerie → Transférer)', 410)
})

export { router as collecteursRouter }

function amountFor(
  groups: Array<{ localisationFonds: string; _sum: { montant: number | null } }>,
  localisationFonds: string
) {
  return groups.find(item => item.localisationFonds === localisationFonds)?._sum.montant ?? 0
}
