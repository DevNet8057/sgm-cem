import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient, FundsTransferStatus } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { formatAmount } from '../lib/utils'

const router = Router()
const prisma = new PrismaClient()

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

  const where: Record<string, unknown> = {
    statut: 'CONFIRME',
    localisationFonds: { in: ['CHEZ_COLLECTEUR', 'EN_TRANSIT'] },
  }

  if (myRole === 'COLLECTEUR') {
    ;(where as { collecteurId?: string }).collecteurId = myUserId
  }

  const contributions = await prisma.contribution.findMany({
    where,
    include: {
      collecteur: { select: { id: true, fullName: true, email: true, role: true } },
      membre: { include: { user: { select: { fullName: true } } } },
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
      role: { in: ['ADMIN', 'TRESORIER', 'RESPONSABLE', 'ADJOINT_RESPONSABLE', 'COLLECTEUR'] },
    },
    select: { id: true, fullName: true, email: true, role: true },
    orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
  })

  // Exclure l'utilisateur actuel
  const eligible = users.filter(u => u.id !== myUserId)

  res.json({ success: true, data: eligible })
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
      role: { in: ['ADMIN', 'TRESORIER', 'RESPONSABLE', 'ADJOINT_RESPONSABLE', 'COLLECTEUR'] },
    },
    select: { id: true, fullName: true, role: true },
  })

  if (!receiver) {
    throw new AppError('INVALID_TARGET', 'Destinataire invalide', 400)
  }

  // Vérifier les contributions appartiennent à l'expéditeur et sont en CHEZ_COLLECTEUR
  const contributions = await prisma.contribution.findMany({
    where: {
      id: { in: data.contributionIds },
      statut: 'CONFIRME',
      // RB-27: Seules les contributions en CHEZ_COLLECTEUR peuvent être transférées
      localisationFonds: 'CHEZ_COLLECTEUR',
      ...(myRole === 'COLLECTEUR' ? { collecteurId: myUserId } : {}),
    },
    select: { id: true, montant: true, collecteurId: true },
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

    // Mettre les contributions en EN_TRANSIT
    await tx.contribution.updateMany({
      where: { id: { in: data.contributionIds } },
      data: {
        localisationFonds: 'EN_TRANSIT',
        transferId: transfer.id,
      },
    })

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

  // Déterminer la nouvelle localisation selon le rôle du récepteur
  const newLocation: string =
    ['ADMIN', 'TRESORIER'].includes(userRole) ? 'REMIS_TRESORIER' :
    ['RESPONSABLE', 'ADJOINT_RESPONSABLE'].includes(userRole) ? 'CHEZ_RESPONSABLE' :
    'CHEZ_COLLECTEUR'

  const result = await prisma.$transaction(async (tx) => {
    // Mettre à jour le transfert
    const updatedTransfer = await tx.fundsTransfer.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      },
    })

    // Mettre à jour les contributions
    await tx.contribution.updateMany({
      where: { transferId: id },
      data: {
        localisationFonds: newLocation as 'CHEZ_COLLECTEUR' | 'CHEZ_RESPONSABLE' | 'REMIS_TRESORIER' | 'EN_TRANSIT',
        collecteurId: userRole === 'COLLECTEUR' ? userId : undefined,
      },
    })

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
        },
      },
    })

    return updatedTransfer
  })

  // Générer le bordereau PDF
  let borderauUrl: string | undefined
  try {
    borderauUrl = await generateTransferBorderau(transfer)
    await prisma.fundsTransfer.update({
      where: { id },
      data: { borderauUrl },
    })
  } catch (e) {
    console.error('[PDF] Failed to generate borderau:', e)
  }

  // Notification à l'expéditeur
  try {
    await notifyTransferConfirmed({
      senderId: transfer.senderId,
      receiverName: transfer.sender.fullName,
      totalAmount: transfer.totalAmount,
      count: transfer.contributions.length,
      borderauUrl,
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
    // Mettre à jour le transfert
    await tx.fundsTransfer.update({
      where: { id },
      data: {
        status: 'REFUSED',
        refusalReason: data.reason,
        refusedAt: new Date(),
      },
    })

    // Retourner les contributions à l'expéditeur
    const originalCollecteurId = transfer.senderId
    await tx.contribution.updateMany({
      where: { transferId: id },
      data: {
        localisationFonds: 'CHEZ_COLLECTEUR',
        collecteurId: originalCollecteurId,
      },
    })

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
    await tx.fundsTransfer.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    })

    // Retourner les contributions
    await tx.contribution.updateMany({
      where: { transferId: id },
      data: {
        localisationFonds: 'CHEZ_COLLECTEUR',
      },
    })

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

// Services de notification (simples pour l'instant)
async function notifyTransferInitiated(p: {
  receiverId: string
  senderName: string
  totalAmount: number
  count: number
  transferType: string
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
      body: `${p.senderName} vous a transféré ${formatAmount(p.totalAmount)} FCFA (${p.count} contribution(s)). Ouvrez l'application pour confirmer.`,
      type: 'TRANSFER',
      isRead: false,
    },
  })
}

async function notifyTransferConfirmed(p: {
  senderId: string
  receiverName: string
  totalAmount: number
  count: number
  borderauUrl?: string
}): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: p.senderId,
      title: 'Transfert confirmé',
      body: `${p.receiverName} a confirmé la réception de ${formatAmount(p.totalAmount)} FCFA (${p.count} contribution(s)).`,
      type: 'TRANSFER',
      isRead: false,
    },
  })
}

async function notifyTransferRefused(p: {
  senderId: string
  receiverName: string
  totalAmount: number
  reason: string
}): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: p.senderId,
      title: 'Transfert refusé',
      body: `${p.receiverName} a refusé votre transfert de ${formatAmount(p.totalAmount)} FCFA. Motif: ${p.reason}`,
      type: 'TRANSFER',
      isRead: false,
    },
  })
}

async function generateTransferBorderau(transfer: { id: string; totalAmount: number; contributions: { length: number } }): Promise<string> {
  return `${process.env.APP_URL ?? 'http://localhost:3000'}/api/borderau/${transfer.id}.pdf`
}

// ── B6 : Trésorier marque des fonds comme déposés en banque ──────────
router.patch('/bank-deposit', authenticate, async (req, res) => {
  if (!['TRESORIER', 'ADMIN'].includes(req.user!.role)) {
    throw new AppError('ACCESS_DENIED', 'Seul le trésorier peut effectuer un dépôt en banque', 403)
  }

  const schema = z.object({
    contributionIds:   z.array(z.string()).min(1),
    referenceBordereau: z.string().min(1, 'La référence de bordereau est requise'),
    dateBordereau:     z.string().optional(),
    note:              z.string().max(500).optional(),
  })
  const { contributionIds, referenceBordereau, dateBordereau, note } = schema.parse(req.body)

  // Vérifier que toutes les contributions sont chez le trésorier/en caisse
  const contributions = await prisma.contribution.findMany({
    where: {
      id:                { in: contributionIds },
      statut:            'CONFIRME',
      localisationFonds: { in: ['REMIS_TRESORIER', 'EN_CAISSE'] },
    },
    select: { id: true, montant: true, localisationFonds: true },
  })

  if (contributions.length !== contributionIds.length) {
    throw new AppError('BUSINESS_RULE', 'Certaines contributions ne sont pas disponibles pour dépôt en banque (non confirmées ou déjà en banque)')
  }

  const totalAmount = contributions.reduce((sum, c) => sum + c.montant, 0)

  await prisma.contribution.updateMany({
    where: { id: { in: contributionIds } },
    data:  { localisationFonds: 'EN_BANQUE' },
  })

  await prisma.auditLog.create({
    data: {
      userId:     req.user!.userId,
      userName:   req.user!.email,
      action:     'TRANSFER',
      entityType: 'BankDeposit',
      entityId:   referenceBordereau,
      details:    {
        contributionIds,
        referenceBordereau,
        dateBordereau,
        totalAmount,
        note,
      },
    },
  })

  res.json({
    success: true,
    data: { count: contributions.length, totalAmount, referenceBordereau },
  })
})

export { router as fundsRouter }