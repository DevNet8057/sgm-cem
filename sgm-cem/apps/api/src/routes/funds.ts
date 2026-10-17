import { getConfig } from '../services/config.service'
import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { FundsTransferStatus, type LocalisationFonds, type Prisma } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { formatAmount } from '../lib/utils'
import { generateBorderauPdf, generateAndStoreBorderau } from '../services/borderau'
import { getFileStream, getManagedStorageKey, storeFile } from '../services/storage'
import { getPrisma } from '../lib/prisma'
import { DEPOSITABLE_LOCATIONS, TRANSFERABLE_LOCATIONS, checkLedger, positionAt, receptionLocation, recordMovements } from '../services/fund-ledger.service'
import { REMINDER_TITLES, heldFunds, notifiedSince } from '../services/reminders.service'
import { notifyInApp } from '../services/notification'
import { audit } from '../services/audit.service'

const router = Router()
const prisma = getPrisma()

const initiateTransferSchema = z.object({
  receiverId: z.string().min(1),
  contributionIds: z.array(z.string()).min(1).max(100),
  transferType: z.enum(['ESPECES_EN_MAIN', 'DEPOT_MTN', 'DEPOT_ORANGE', 'AUTRE']).optional(),
  senderNote: z.string().max(500).optional(),
})

const refuseTransferSchema = z.object({
  reason: z.string().min(10, 'Le motif doit contenir au moins 10 caractères'),
})

// GET /api/funds/overview - Pipeline complet avec filtre par rôle
router.get('/overview', authenticate, requireLevel(2), async (req, res) => {
  const myRole = req.user!.role
  const myUserId = req.user!.userId

  const where: Record<string, unknown> = {
    statut: 'CONFIRME',
  }

  // Collecteur ne voit que ses propres fonds
  if (myRole === 'COLLECTEUR') {
    ;(where as { collecteurId?: string }).collecteurId = myUserId
  }

  const [flowGroups, transfersPending] = await Promise.all([
    prisma.contribution.groupBy({
      by: ['localisationFonds'],
      where,
      _sum: { montant: true },
      _count: true,
    }),
    prisma.fundsTransfer.count({
      where: {
        receiverId: myUserId,
        status: 'PENDING_APPROVAL',
      },
    }),
  ])

  const flow = {
    chezCollecteur: amountFor(flowGroups, 'CHEZ_COLLECTEUR'),
    enTransit: amountFor(flowGroups, 'EN_TRANSIT'),
    chezResponsable: amountFor(flowGroups, 'CHEZ_RESPONSABLE'),
    remisTresorier: amountFor(flowGroups, 'REMIS_TRESORIER'),
    enCaisse: amountFor(flowGroups, 'EN_CAISSE'),
    portefeuilleElectronique: amountFor(flowGroups, 'PORTEFEUILLE_ELECTRONIQUE'),
    enBanque: amountFor(flowGroups, 'EN_BANQUE'),
    totalConfirme: flowGroups.reduce((sum, item) => sum + (item._sum.montant ?? 0), 0),
  }

  res.json({
    success: true,
    data: {
      flow,
      pendingValidations: transfersPending,
    },
  })
})

// GET /api/funds/contributions - Contributions avec localisations
router.get('/contributions', authenticate, requireLevel(2), async (req, res) => {
  const myRole = req.user!.role
  const myUserId = req.user!.userId

  // Fonds détenus par des personnes ; chacun ne voit que ce qu'il détient,
  // les rôles de supervision voient tout
  const where: Prisma.ContributionWhereInput = {
    statut: 'CONFIRME',
    localisationFonds: { in: [...TRANSFERABLE_LOCATIONS, 'EN_TRANSIT'] },
    ...(['TRESORIER', 'ADMIN', 'DEVELOPER'].includes(myRole) ? {} : { detenteurId: myUserId }),
  }

  const contributions = await prisma.contribution.findMany({
    where,
    include: {
      collecteur: { select: { id: true, fullName: true, email: true, role: true } },
      membre: { include: { user: { select: { fullName: true } } } },
      contributeurExterne: { select: { nom: true } },
      rubrique: { select: { code: true, title: true } },
      fundsTransfer: { select: { id: true, status: true, senderName: true, receiverName: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  res.json({ success: true, data: contributions })
})

// GET /api/funds/eligible-receivers - Destinataires possibles pour un transfert
router.get('/eligible-receivers', authenticate, requireLevel(2), async (req, res) => {
  const myUserId = req.user!.userId

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { in: ['ADMIN', 'DEVELOPER', 'TRESORIER', 'RESPONSABLE', 'ADJOINT_RESPONSABLE', 'COLLECTEUR'] },
    },
    select: { id: true, fullName: true, email: true, role: true },
    orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
  })

  // Exclure l'utilisateur actuel
  const eligible = users.filter(u => u.id !== myUserId)

  res.json({ success: true, data: eligible })
})

// POST /api/funds/remise-requests - Demande de remise (EF-M07-04) : le trésorier
// demande à un détenteur de lui remettre ses fonds. Notification ciblée seulement,
// aucun effet comptable ; une demande par détenteur et par heure au plus.
const remiseRequestSchema = z.object({
  detenteurId: z.string().min(1),
  message: z.string().trim().max(300).optional(),
})

router.post('/remise-requests', authenticate, requireLevel(4), async (req, res) => {
  const { detenteurId, message } = remiseRequestSchema.parse(req.body)
  if (detenteurId === req.user!.userId) throw new AppError('BUSINESS_RULE', 'Vous ne pouvez pas vous adresser une demande de remise.', 400)
  const holder = await prisma.user.findUnique({ where: { id: detenteurId }, select: { id: true, fullName: true, isActive: true } })
  if (!holder || !holder.isActive) throw new AppError('NOT_FOUND', 'Détenteur introuvable', 404)

  const held = await heldFunds(detenteurId)
  if (held.total <= 0) throw new AppError('BUSINESS_RULE', `${holder.fullName} ne détient aucun fonds à remettre.`, 400)
  if (await notifiedSince(detenteurId, REMINDER_TITLES.remise, new Date(Date.now() - 60 * 60 * 1000))) {
    throw new AppError('DUPLICATE', 'Une demande de remise lui a déjà été envoyée il y a moins d\'une heure.', 409)
  }

  const requester = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { fullName: true } })
  const requesterName = requester?.fullName ?? req.user!.email
  await notifyInApp(detenteurId, REMINDER_TITLES.remise,
    `${requesterName} vous demande de lui remettre ${formatAmount(held.total)} (${held.count} contribution(s)).${message ? ` Message : ${message}` : ''}`,
    'REMISE', { kind: 'demande-remise', requesterId: req.user!.userId }, { view: 'collecteurs' })
  await audit({
    req, userId: req.user!.userId, userName: req.user!.email, action: 'CREATE',
    entityType: 'DemandeRemise', entityId: detenteurId,
    details: { detenteurName: holder.fullName, montant: held.total, count: held.count, ...(message ? { message } : {}) },
  })

  res.status(201).json({ success: true, data: { detenteurId, detenteurName: holder.fullName, montant: held.total, count: held.count } })
})

// POST /api/funds/transfer - Initier un transfert
router.post('/transfer', authenticate, requireLevel(2), async (req, res) => {
  const data = initiateTransferSchema.parse(req.body)
  const myUserId = req.user!.userId
  const myRole = req.user!.role as string

  // Vérifier le destinataire
  const receiver = await prisma.user.findFirst({
    where: {
      id: data.receiverId,
      isActive: true,
      role: { in: ['ADMIN', 'DEVELOPER', 'TRESORIER', 'RESPONSABLE', 'ADJOINT_RESPONSABLE', 'COLLECTEUR'] },
    },
    select: { id: true, fullName: true, role: true },
  })

  if (!receiver || receiver.id === myUserId) {
    throw new AppError('INVALID_TARGET', 'Destinataire invalide', 400)
  }

  // RB-27 / RG-21 : seuls les fonds détenus par une personne (collecteur ou
  // responsable) peuvent être remis. Chacun ne remet que l'argent qu'il détient ;
  // l'administrateur peut initier pour un détenteur (le destinataire confirme toujours).
  const contributions = await prisma.contribution.findMany({
    where: {
      id: { in: data.contributionIds },
      statut: 'CONFIRME',
      localisationFonds: { in: [...TRANSFERABLE_LOCATIONS] },
      ...(['ADMIN', 'DEVELOPER'].includes(myRole) ? {} : { detenteurId: myUserId }),
    },
    select: { id: true, montant: true, localisationFonds: true, detenteurId: true },
  })

  if (contributions.length !== data.contributionIds.length) {
    throw new AppError('BUSINESS_RULE', 'Une ou plusieurs contributions sont invalides ou non autorisées', 403)
  }

  const totalAmount = contributions.reduce((sum, c) => sum + c.montant, 0)

  // Créer le transfert dans une transaction
  const result = await prisma.$transaction(async (tx) => {
    const sender = await tx.user.findUnique({
      where: { id: myUserId },
      select: { fullName: true },
    })

    const transfer = await tx.fundsTransfer.create({
      data: {
        senderId: myUserId,
        senderName: sender?.fullName ?? 'Inconnu',
        receiverId: data.receiverId,
        receiverName: receiver.fullName,
        totalAmount,
        transferType: (data.transferType as 'ESPECES_EN_MAIN' | 'DEPOT_MTN' | 'DEPOT_ORANGE' | 'AUTRE') ?? 'ESPECES_EN_MAIN',
        senderNote: data.senderNote,
        contributions: {
          connect: contributions.map(c => ({ id: c.id })),
        },
      },
    })

    // Mettre les contributions en EN_TRANSIT — conditionnel : une même
    // contribution ne peut pas partir dans deux transferts simultanés. Le détenteur
    // reste responsable de l'argent jusqu'à la réception.
    const moved = await tx.contribution.updateMany({
      where: { id: { in: data.contributionIds }, localisationFonds: { in: [...TRANSFERABLE_LOCATIONS] }, statut: 'CONFIRME' },
      data: {
        localisationFonds: 'EN_TRANSIT',
        transferId: transfer.id,
      },
    })
    if (moved.count !== data.contributionIds.length) {
      throw new AppError('BUSINESS_RULE', 'Une ou plusieurs contributions viennent d\'être transférées, rechargez la page', 409)
    }
    await recordMovements(tx, contributions.map(c => ({
      contributionId: c.id, montant: c.montant, from: c.localisationFonds, to: 'EN_TRANSIT' as const,
      holderFromId: c.detenteurId, holderToId: c.detenteurId, reason: 'TRANSFERT_ENVOI' as const,
      transferId: transfer.id, actorId: myUserId,
    })))

    // Audit log
    await tx.auditLog.create({
      data: {
        userId: myUserId,
        userName: sender?.fullName ?? 'Inconnu',
        action: 'TRANSFER',
        entityType: 'FundsTransfer',
        entityId: transfer.id,
        details: {
          contributionIds: data.contributionIds,
          receiverId: data.receiverId,
          receiverName: receiver.fullName,
          totalAmount,
          transferType: data.transferType,
        },
      },
    })

    return transfer
  })

  // Notification au récepteur
  try {
    await notifyTransferInitiated({
      receiverId: receiver.id,
      senderName: result.senderName,
      totalAmount: result.totalAmount,
      count: contributions.length,
      transferType: result.transferType,
      transferId: result.id,
    })
  } catch (e) {
    console.error('[Notification] Failed to notify receiver:', e)
  }

  res.json({ success: true, data: result })
})

// GET /api/funds/transfers - Liste des transferts
router.get('/transfers', authenticate, requireLevel(2), async (req, res) => {
  const myRole = req.user!.role
  const myUserId = req.user!.userId

  const where: Record<string, unknown> = {}

  if (myRole === 'COLLECTEUR') {
    ;(where as { OR?: Array<Record<string, string>> }).OR = [
      { senderId: myUserId },
      { receiverId: myUserId },
    ]
  }

  const transfers = await prisma.fundsTransfer.findMany({
    where,
    include: {
      contributions: {
        select: {
          id: true, montant: true, modePaiement: true,
          membre: { include: { user: { select: { fullName: true } } } },
          contributeurExterne: { select: { nom: true } },
          rubrique: { select: { code: true, title: true } },
        },
      },
      sender: { select: { role: true } },
      receiver: { select: { role: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  res.json({ success: true, data: transfers })
})

// GET /api/funds/transfers/pending-my-approval - Transferts en attente de validation
router.get('/transfers/pending-my-approval', authenticate, requireLevel(2), async (req, res) => {
  const myUserId = req.user!.userId

  const transfers = await prisma.fundsTransfer.findMany({
    where: {
      receiverId: myUserId,
      status: 'PENDING_APPROVAL',
    },
    include: {
      contributions: {
        include: {
          membre: { include: { user: { select: { fullName: true } } } },
          contributeurExterne: { select: { nom: true } },
          rubrique: { select: { code: true, title: true } },
        },
      },
      sender: { select: { role: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  res.json({ success: true, data: transfers })
})

// PATCH /api/funds/transfers/:id/confirm - Confirmer la réception
router.patch('/transfers/:id/confirm', authenticate, requireLevel(2), async (req, res) => {
  const id = String(req.params.id)
  const userId = req.user!.userId
  const userRole = req.user!.role as string

  const transfer = await prisma.fundsTransfer.findUnique({
    where: { id },
    include: { contributions: true, sender: true },
  })

  if (!transfer) {
    throw new AppError('NOT_FOUND', 'Transfert introuvable', 404)
  }

  // RB-23: Seul le récepteur peut confirmer
  if (transfer.receiverId !== userId) {
    throw new AppError('NOT_YOUR_TRANSFER', 'Vous n\'êtes pas le récepteur de ce transfert', 403)
  }

  // RB-25: Un transfert confirmé est immuable
  if (transfer.status !== 'PENDING_APPROVAL') {
    throw new AppError('ALREADY_PROCESSED', 'Ce transfert a déjà été traité', 400)
  }

  // Nouvelle localisation selon le rôle du récepteur (RG-22), qui devient détenteur
  const newLocation = receptionLocation(userRole)

  await prisma.$transaction(async (tx) => {
    // Transition conditionnelle : une seule réponse (confirmation OU refus OU annulation)
    const claimed = await tx.fundsTransfer.updateMany({
      where: { id, status: 'PENDING_APPROVAL' },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      },
    })
    if (claimed.count !== 1) throw new AppError('ALREADY_PROCESSED', 'Ce transfert a déjà été traité', 400)

    // Les fonds changent de détenteur ; l'auteur de l'encaissement (collecteurId) ne change pas
    const inTransit = await tx.contribution.findMany({
      where: { transferId: id, localisationFonds: 'EN_TRANSIT' },
      select: { id: true, montant: true, detenteurId: true },
    })
    await tx.contribution.updateMany({
      where: { id: { in: inTransit.map(c => c.id) }, localisationFonds: 'EN_TRANSIT' },
      data: { localisationFonds: newLocation, detenteurId: userId },
    })
    await recordMovements(tx, inTransit.map(c => ({
      contributionId: c.id, montant: c.montant, from: 'EN_TRANSIT' as const, to: newLocation,
      holderFromId: c.detenteurId, holderToId: userId, reason: 'TRANSFERT_RECEPTION' as const,
      transferId: id, actorId: userId,
    })))

    // Audit log
    await tx.auditLog.create({
      data: {
        userId,
        userName: req.user!.email,
        action: 'TRANSFER_CONFIRMED',
        entityType: 'FundsTransfer',
        entityId: id,
        details: {
          fromStatus: 'PENDING_APPROVAL',
          toStatus: 'CONFIRMED',
          newLocation,
        },
      },
    })
  })

  // Générer le bordereau PDF
  const borderauUrl = await generateAndStoreBorderau(id) ?? undefined

  // Notification à l'expéditeur
  try {
    await notifyTransferConfirmed({
      senderId: transfer.senderId,
      receiverName: transfer.sender.fullName,
      totalAmount: transfer.totalAmount,
      count: transfer.contributions.length,
      borderauUrl,
      transferId: transfer.id,
    })
  } catch (e) {
    console.error('[Notification] Failed to notify sender:', e)
  }

  res.json({ success: true, data: { borderauUrl } })
})

// PATCH /api/funds/transfers/:id/refuse - Refuser avec motif
router.patch('/transfers/:id/refuse', authenticate, requireLevel(2), async (req, res) => {
  const id = String(req.params.id)
  const data = refuseTransferSchema.parse(req.body)
  const userId = req.user!.userId

  const transfer = await prisma.fundsTransfer.findUnique({
    where: { id },
    include: { contributions: true, sender: true },
  })

  if (!transfer) {
    throw new AppError('NOT_FOUND', 'Transfert introuvable', 404)
  }

  // RB-23: Seul le récepteur peut refuser
  if (transfer.receiverId !== userId) {
    throw new AppError('NOT_YOUR_TRANSFER', 'Vous n\'êtes pas le récepteur de ce transfert', 403)
  }

  if (transfer.status !== 'PENDING_APPROVAL') {
    throw new AppError('ALREADY_PROCESSED', 'Ce transfert a déjà été traité', 400)
  }

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.fundsTransfer.updateMany({
      where: { id, status: 'PENDING_APPROVAL' },
      data: {
        status: 'REFUSED',
        refusalReason: data.reason,
        refusedAt: new Date(),
      },
    })
    if (claimed.count !== 1) throw new AppError('ALREADY_PROCESSED', 'Ce transfert a déjà été traité', 400)

    // Les fonds reviennent chez leur détenteur, à leur emplacement d'origine
    await returnTransferFunds(tx, id, 'TRANSFERT_REFUS', userId)

    // Audit log
    await tx.auditLog.create({
      data: {
        userId,
        userName: req.user!.email,
        action: 'TRANSFER_REFUSED',
        entityType: 'FundsTransfer',
        entityId: id,
        details: {
          reason: data.reason,
        },
      },
    })
  })

  // Notification à l'expéditeur et alerte au trésorier
  try {
    await notifyTransferRefused({
      senderId: transfer.senderId,
      receiverName: transfer.sender.fullName,
      totalAmount: transfer.totalAmount,
      reason: data.reason,
      transferId: transfer.id,
    })
  } catch (e) {
    console.error('[Notification] Failed to notify refusal:', e)
  }

  res.json({ success: true })
})

// PATCH /api/funds/transfers/:id/cancel - Annuler (par l'expéditeur)
router.patch('/transfers/:id/cancel', authenticate, requireLevel(2), async (req, res) => {
  const id = String(req.params.id)
  const myUserId = req.user!.userId

  const transfer = await prisma.fundsTransfer.findUnique({
    where: { id },
    include: { contributions: true },
  })

  if (!transfer) {
    throw new AppError('NOT_FOUND', 'Transfert introuvable', 404)
  }

  // RB-29: Seul l'expéditeur peut annuler
  if (transfer.senderId !== myUserId) {
    throw new AppError('FORBIDDEN', 'Seul l\'expéditeur peut annuler ce transfert', 403)
  }

  // RB-29: Seulement si PENDING_APPROVAL
  if (transfer.status !== 'PENDING_APPROVAL') {
    throw new AppError('BUSINESS_RULE', 'Ce transfert ne peut pas être annulé', 400)
  }

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.fundsTransfer.updateMany({
      where: { id, status: 'PENDING_APPROVAL' },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    })
    if (claimed.count !== 1) throw new AppError('BUSINESS_RULE', 'Ce transfert ne peut plus être annulé', 400)

    // Retourner les contributions à leur emplacement d'origine
    await returnTransferFunds(tx, id, 'TRANSFERT_ANNULATION', myUserId)

    // Audit log
    await tx.auditLog.create({
      data: {
        userId: myUserId,
        userName: req.user!.email,
        action: 'TRANSFER_CANCELLED',
        entityType: 'FundsTransfer',
        entityId: id,
      },
    })
  })

  res.json({ success: true })
})

function amountFor(
  groups: Array<{ localisationFonds: string; _sum: { montant: number | null } }>,
  localisationFonds: string
) {
  return groups.find(item => item.localisationFonds === localisationFonds)?._sum.montant ?? 0
}

/**
 * Refus ou annulation d'un transfert : chaque contribution retourne à
 * l'emplacement qu'elle avait à l'envoi (lu dans le grand livre ; « chez le
 * collecteur » pour les transferts antérieurs au grand livre). Le détenteur n'a pas changé.
 */
async function returnTransferFunds(tx: Prisma.TransactionClient, transferId: string, reason: 'TRANSFERT_REFUS' | 'TRANSFERT_ANNULATION', actorId: string) {
  const inTransit = await tx.contribution.findMany({
    where: { transferId, localisationFonds: 'EN_TRANSIT' },
    select: { id: true, montant: true, detenteurId: true },
  })
  if (inTransit.length === 0) return
  const sent = await tx.fundMovement.findMany({
    where: { transferId, reason: 'TRANSFERT_ENVOI', contributionId: { in: inTransit.map(c => c.id) } },
    select: { contributionId: true, fromLocation: true },
  })
  const origin = new Map(sent.map(m => [m.contributionId, m.fromLocation ?? 'CHEZ_COLLECTEUR']))
  const byLocation = new Map<LocalisationFonds, string[]>()
  for (const c of inTransit) {
    const back = origin.get(c.id) ?? 'CHEZ_COLLECTEUR'
    byLocation.set(back, [...(byLocation.get(back) ?? []), c.id])
  }
  for (const [location, ids] of byLocation) {
    await tx.contribution.updateMany({ where: { id: { in: ids }, localisationFonds: 'EN_TRANSIT' }, data: { localisationFonds: location } })
  }
  await recordMovements(tx, inTransit.map(c => ({
    contributionId: c.id, montant: c.montant, from: 'EN_TRANSIT' as const, to: origin.get(c.id) ?? 'CHEZ_COLLECTEUR',
    holderFromId: c.detenteurId, holderToId: c.detenteurId, reason, transferId, actorId,
  })))
}

// Services de notification (simples pour l'instant)
// targetView : 'transfer-validations' pour le récepteur (écran où il confirme/refuse
// réellement) ; 'collecteurs' pour l'expéditeur (Fonds Collecteurs — c'est là
// qu'apparaît le suivi/traçabilité de SES transferts, pas un écran d'action puisque
// le transfert est déjà résolu à ce stade).
async function notifyTransferInitiated(p: {
  receiverId: string
  senderName: string
  totalAmount: number
  count: number
  transferType: string
  transferId: string
}): Promise<void> {
  const transferTypeLabel: Record<string, string> = {
    ESPECES_EN_MAIN: 'En main propre',
    DEPOT_MTN: 'Dépôt MTN MoMo',
    DEPOT_ORANGE: 'Dépôt Orange Money',
    AUTRE: 'Autre mode',
  }

  await prisma.notification.create({
    data: {
      userId: p.receiverId,
      title: 'Transfert à valider',
      body: `${p.senderName} vous a transféré ${formatAmount(p.totalAmount)} (${p.count} contribution(s)). Ouvrez l'application pour confirmer.`,
      type: 'TRANSFER',
      isRead: false,
      targetView: 'transfer-validations',
      targetId: p.transferId,
    },
  })
}

async function notifyTransferConfirmed(p: {
  senderId: string
  receiverName: string
  totalAmount: number
  count: number
  borderauUrl?: string
  transferId: string
}): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: p.senderId,
      title: 'Transfert confirmé',
      body: `${p.receiverName} a confirmé la réception de ${formatAmount(p.totalAmount)} (${p.count} contribution(s)).`,
      type: 'TRANSFER',
      isRead: false,
      targetView: 'collecteurs',
      targetId: p.transferId,
    },
  })
}

async function notifyTransferRefused(p: {
  senderId: string
  receiverName: string
  totalAmount: number
  reason: string
  transferId: string
}): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: p.senderId,
      title: 'Transfert refusé',
      body: `${p.receiverName} a refusé votre transfert de ${formatAmount(p.totalAmount)}. Motif: ${p.reason}`,
      type: 'TRANSFER',
      isRead: false,
      targetView: 'collecteurs',
      targetId: p.transferId,
    },
  })
}

// ── B6 : Trésorier marque des fonds comme déposés en banque ──────────
// Décision du Bureau (17/10/2026) : « En banque » seulement avec le reçu de dépôt
// (PDF ou photo), stocké et archivé — jamais public, consultable par la trésorerie.
const PROOF_TYPES: Array<{ mime: string; ext: string; magic: (b: Buffer) => boolean }> = [
  { mime: 'application/pdf', ext: 'pdf', magic: b => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/jpeg', ext: 'jpg', magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', magic: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', magic: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
]

const proofUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } })

function receiveProof(req: Request, res: Response, next: NextFunction) {
  proofUpload.single('proof')(req, res, err => {
    if (err) return next(new AppError('VALIDATION_ERROR', err.code === 'LIMIT_FILE_SIZE' ? 'Reçu trop volumineux (10 Mo maximum)' : 'Fichier de reçu illisible', 400))
    next()
  })
}

router.patch('/bank-deposit', authenticate, receiveProof, async (req, res) => {
  if (!['TRESORIER', 'ADMIN', 'DEVELOPER'].includes(req.user!.role)) {
    throw new AppError('ACCESS_DENIED', 'Seul le trésorier peut effectuer un dépôt en banque', 403)
  }

  const schema = z.object({
    // multipart : la liste arrive en JSON
    contributionIds:   z.preprocess(v => (typeof v === 'string' ? JSON.parse(v) : v), z.array(z.string()).min(1).max(500)),
    referenceBordereau: z.string().trim().min(1, 'La référence de bordereau est requise').max(120),
    dateBordereau:     z.string().optional(),
    note:              z.string().max(500).optional(),
  })
  const { contributionIds, referenceBordereau, dateBordereau, note } = schema.parse(req.body)

  const file = req.file
  if (!file) throw new AppError('VALIDATION_ERROR', 'Le reçu de dépôt (PDF ou photo) est obligatoire', 400)
  // Type vérifié sur le contenu du fichier, pas sur ce que déclare le navigateur
  const proofType = PROOF_TYPES.find(t => t.magic(file.buffer))
  if (!proofType) throw new AppError('VALIDATION_ERROR', 'Reçu non reconnu : PDF, JPEG, PNG ou WebP uniquement', 400)

  // Déposables : fonds chez le trésorier, en caisse ou sur le portefeuille électronique
  const contributions = await prisma.contribution.findMany({
    where: {
      id:                { in: contributionIds },
      statut:            'CONFIRME',
      localisationFonds: { in: [...DEPOSITABLE_LOCATIONS] },
      bankDepositId:     null,
    },
    select: { id: true, montant: true, localisationFonds: true, detenteurId: true },
  })

  if (contributions.length !== contributionIds.length) {
    throw new AppError('BUSINESS_RULE', 'Certaines contributions ne sont pas disponibles pour dépôt en banque (non confirmées ou déjà en banque)')
  }

  const totalAmount = contributions.reduce((sum, c) => sum + c.montant, 0)

  const depositor = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, fullName: true },
  })

  // Le reçu est stocké avant l'écriture en base (clé unique, jamais écrasée)
  const now = new Date()
  const key = `banque/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/depot-${randomUUID()}.${proofType.ext}`
  const stored = await storeFile(key, file.buffer, proofType.mime)

  // Enregistrement du dépôt, déplacement des fonds et grand livre : tout ou rien,
  // et une contribution ne peut pas entrer dans deux dépôts simultanés
  const deposit = await prisma.$transaction(async tx => {
    const created = await tx.bankDeposit.create({
      data: {
        referenceBordereau,
        dateBordereau: dateBordereau ? new Date(dateBordereau) : null,
        note,
        totalAmount,
        depositedById: req.user!.userId,
        depositedByName: depositor?.fullName ?? req.user!.email,
        proofKey: stored.s3Key,
        proofBucket: stored.s3Bucket,
        proofMime: proofType.mime,
        proofName: file.originalname.slice(0, 200),
        proofSize: file.size,
      },
    })
    const moved = await tx.contribution.updateMany({
      where: { id: { in: contributionIds }, statut: 'CONFIRME', localisationFonds: { in: [...DEPOSITABLE_LOCATIONS] }, bankDepositId: null },
      data:  { localisationFonds: 'EN_BANQUE', bankDepositId: created.id, detenteurId: null },
    })
    if (moved.count !== contributionIds.length) {
      throw new AppError('BUSINESS_RULE', 'Certaines contributions viennent d\'être déposées, rechargez la page', 409)
    }
    await recordMovements(tx, contributions.map(c => ({
      contributionId: c.id, montant: c.montant, from: c.localisationFonds, to: 'EN_BANQUE' as const,
      holderFromId: c.detenteurId, holderToId: null, reason: 'DEPOT_BANCAIRE' as const,
      bankDepositId: created.id, actorId: req.user!.userId,
    })))
    return created
  })

  await prisma.auditLog.create({
    data: {
      userId:     req.user!.userId,
      userName:   depositor?.fullName ?? req.user!.email,
      action:     'TRANSFER',
      entityType: 'BankDeposit',
      entityId:   deposit.id,
      details:    {
        contributionIds,
        referenceBordereau,
        dateBordereau,
        totalAmount,
        note,
        proof: { name: deposit.proofName, mime: deposit.proofMime, size: deposit.proofSize },
      },
    },
  })

  res.json({
    success: true,
    data: { id: deposit.id, count: contributions.length, totalAmount, referenceBordereau },
  })
})

// ── Grand livre (jalon J3) ────────────────────────────────────────────
// Contrôle d'invariant : emplacement et détenteur actuels = dernier mouvement
router.get('/ledger/check', authenticate, requireLevel(4), async (_req, res) => {
  res.json({ success: true, data: await checkLedger(prisma) })
})

// Position des fonds à une date (fin de journée, heure de Yaoundé)
router.get('/position', authenticate, requireLevel(4), async (req, res) => {
  const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ').optional() }).parse(req.query)
  const at = date ? new Date(`${date}T23:59:59.999+01:00`) : new Date()
  res.json({ success: true, data: await positionAt(prisma, at) })
})

// Reçu de dépôt archivé : servi par l'API (jamais d'URL publique)
router.get('/bank-deposits/:id/proof', authenticate, requireLevel(4), async (req, res) => {
  const deposit = await prisma.bankDeposit.findUnique({
    where: { id: String(req.params.id) },
    select: { proofKey: true, proofBucket: true, proofMime: true, proofName: true },
  })
  if (!deposit?.proofKey) throw new AppError('NOT_FOUND', 'Aucun reçu pour ce dépôt', 404)
  const file = await getFileStream(deposit.proofKey, deposit.proofBucket === 'local' ? undefined : deposit.proofBucket ?? undefined)
  if (!file) throw new AppError('NOT_FOUND', 'Reçu introuvable dans le stockage', 404)
  res.setHeader('Content-Type', deposit.proofMime ?? 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(deposit.proofName ?? 'recu-depot')}"`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, no-store')
  file.stream.pipe(res)
})

// ── B6 : Historique des dépôts bancaires — PREUVES consultables ───────
// L'ADMIN (et le trésorier) voit chaque dépôt : référence de bordereau/relevé,
// date, montant, déposant, et le détail des contributions couvertes.
router.get('/bank-deposits', authenticate, requireLevel(4), async (_req, res) => {
  const deposits = await prisma.bankDeposit.findMany({
    include: {
      contributions: {
        select: {
          id: true, montant: true, modePaiement: true,
          membre: { include: { user: { select: { fullName: true } } } },
          contributeurExterne: { select: { nom: true } },
          rubrique: { select: { code: true, title: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  // L'emplacement du reçu reste interne ; le web l'obtient via /bank-deposits/:id/proof
  res.json({ success: true, data: deposits.map(({ proofKey, proofBucket, ...d }) => ({ ...d, hasProof: Boolean(proofKey && proofBucket !== undefined) })) })
})

/**
 * GET /api/funds/transfers/:id/borderau
 * Bordereau PDF — vue inline par défaut (?download=1 force le téléchargement).
 * Réservé à l'expéditeur, au récepteur, ou à un rôle de supervision.
 */
router.get('/transfers/:id/borderau', authenticate, requireLevel(2), async (req, res) => {
  const id = String(req.params.id)
  const myUserId = req.user!.userId
  const myRole = req.user!.role as string

  const transfer = await prisma.fundsTransfer.findUnique({ where: { id } })
  if (!transfer) throw new AppError('NOT_FOUND', 'Transfert introuvable', 404)
  if (transfer.status !== 'CONFIRMED') {
    throw new AppError('BUSINESS_RULE', 'Le bordereau est disponible uniquement pour les transferts confirmés', 400)
  }
  const canView = transfer.senderId === myUserId || transfer.receiverId === myUserId || ['ADMIN', 'DEVELOPER', 'TRESORIER'].includes(myRole)
  if (!canView) throw new AppError('ACCESS_DENIED', 'Accès refusé à ce bordereau', 403)

  let pdfBuffer: Buffer | null = null
  const key = transfer.borderauUrl ? getManagedStorageKey(transfer.borderauUrl) : null

  if (key) {
    const file = await getFileStream(key)
    if (file) {
      const chunks: Buffer[] = []
      for await (const chunk of file.stream) chunks.push(chunk as Buffer)
      pdfBuffer = Buffer.concat(chunks)
    }
  }

  if (!pdfBuffer) {
    pdfBuffer = await generateBorderauPdf(id)
    await generateAndStoreBorderau(id)
  }

  const filename = `Bordereau-CEM-${id.substring(0, 8).toUpperCase()}.pdf`
  const disposition = req.query.download === '1' ? 'attachment' : 'inline'
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`)
  res.send(pdfBuffer)
})

export { router as fundsRouter }
