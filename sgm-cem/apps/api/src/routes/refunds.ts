// Remboursements à double validation (lot 4.1 — EF-M16-01/02, décision du
// Bureau) : le trésorier demande, un administrateur ou un responsable vise,
// le trésorier rend l'argent HORS application puis enregistre l'exécution
// avec une preuve obligatoire. Total ou partiel. Aucun envoi d'argent ici.
import { Router } from 'express'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel, requireRole } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { getPrisma } from '../lib/prisma'
import { formatAmount } from '../lib/utils'
import { receiveProof, requireProof } from '../lib/proof-upload'
import { audit } from '../services/audit.service'
import { notifyInApp } from '../services/notification'
import { getFileStream, storeFile } from '../services/storage'
import { REFUND_SOURCES, refundableAmount } from '../services/refund.service'

const router = Router()
const prisma = getPrisma()
const VALIDATOR_ROLES = ['ADMIN', 'RESPONSABLE'] as const
const MOYEN_LABELS: Record<string, string> = { ESPECES: 'espèces', MOBILE_MONEY: 'Mobile Money', VIREMENT: 'virement' }

async function nameOf(userId: string, fallback: string) {
  return (await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }))?.fullName ?? fallback
}

async function notifyValidators(title: string, body: string, refundId: string) {
  const users = await prisma.user.findMany({ where: { isActive: true, role: { in: [...VALIDATOR_ROLES] } }, select: { id: true } })
  await Promise.all(users.map(u => notifyInApp(u.id, title, body, 'ALERTE', { kind: 'remboursement', refundId }, { view: 'remboursements', id: refundId })))
}

// GET /api/refunds — suivi (trésorerie et viseurs)
router.get('/', authenticate, requireLevel(3), async (req, res) => {
  const statut = z.enum(['DEMANDE', 'VALIDE', 'EXECUTE', 'REJETE', 'ANNULE']).optional().parse(req.query.statut || undefined)
  const refunds = await prisma.remboursement.findMany({
    where: statut ? { statut } : {},
    include: {
      contribution: {
        select: {
          id: true, montant: true, modePaiement: true, createdAt: true,
          membre: { select: { user: { select: { fullName: true } } } },
          nomDonateur: true,
          contributeurExterne: { select: { nom: true } },
          rubrique: { select: { code: true, title: true } },
        },
      },
    },
    orderBy: { requestedAt: 'desc' },
    take: 200,
  })
  res.json({ success: true, data: refunds.map(({ proofKey, proofBucket, ...r }) => ({ ...r, hasProof: Boolean(proofKey) })) })
})

// POST /api/refunds — demande du trésorier
const createSchema = z.object({
  contributionId: z.string().min(1),
  montant: z.number().int().positive(),
  moyen: z.enum(['ESPECES', 'MOBILE_MONEY', 'VIREMENT']),
  motif: z.string().trim().min(10, 'Motif de 10 caractères minimum').max(500),
  beneficiaire: z.string().trim().max(120).optional(),
})

router.post('/', authenticate, requireRole('TRESORIER'), async (req, res) => {
  const data = createSchema.parse(req.body)
  const requesterName = await nameOf(req.user!.userId, req.user!.email)
  // Ligne de la contribution verrouillée : deux demandes simultanées ne dépassent pas le montant
  const refund = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "contributions" WHERE "id" = ${data.contributionId} FOR UPDATE`
    const contribution = await tx.contribution.findUnique({ where: { id: data.contributionId }, select: { id: true, montant: true, statut: true, rubriqueId: true, membreId: true } })
    if (!contribution) throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
    if (contribution.statut !== 'CONFIRME') throw new AppError('BUSINESS_RULE', 'Seule une contribution confirmée peut être remboursée.', 400)
    const available = await refundableAmount(tx, contribution)
    if (data.montant > available) {
      throw new AppError('BUSINESS_RULE', `Montant trop élevé : ${formatAmount(available)} au plus restent remboursables sur cette contribution.`, 400, 'montant')
    }
    return tx.remboursement.create({
      data: { ...data, rubriqueId: contribution.rubriqueId, membreId: contribution.membreId, requestedById: req.user!.userId, requestedByName: requesterName },
    })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })

  await audit({ req, userId: req.user!.userId, userName: req.user!.email, action: 'CREATE', entityType: 'Remboursement', entityId: refund.id, details: { contributionId: refund.contributionId, montant: refund.montant, moyen: refund.moyen, motif: refund.motif } })
  await notifyValidators('Remboursement à viser', `${requesterName} demande un remboursement de ${formatAmount(refund.montant)} (${MOYEN_LABELS[refund.moyen]}). Motif : ${refund.motif}`, refund.id)
  res.status(201).json({ success: true, data: refund })
})

async function transition(id: string, from: Array<'DEMANDE' | 'VALIDE'>, data: Prisma.RemboursementUpdateManyMutationInput) {
  const result = await prisma.remboursement.updateMany({ where: { id, statut: { in: from } }, data })
  if (result.count !== 1) {
    const exists = await prisma.remboursement.findUnique({ where: { id }, select: { statut: true } })
    if (!exists) throw new AppError('NOT_FOUND', 'Remboursement introuvable', 404)
    throw new AppError('BUSINESS_RULE', 'Ce remboursement a déjà été traité.', 409)
  }
  return prisma.remboursement.findUniqueOrThrow({ where: { id } })
}

// PATCH /api/refunds/:id/validate — second visa (administrateur ou responsable)
router.patch('/:id/validate', authenticate, requireRole(...VALIDATOR_ROLES), async (req, res) => {
  const id = String(req.params.id)
  const current = await prisma.remboursement.findUnique({ where: { id }, select: { requestedById: true } })
  if (current?.requestedById === req.user!.userId) throw new AppError('FORBIDDEN', 'Le visa doit venir d\'une autre personne que le demandeur.', 403)
  const refund = await transition(id, ['DEMANDE'], { statut: 'VALIDE', validatedById: req.user!.userId, validatedByName: await nameOf(req.user!.userId, req.user!.email), validatedAt: new Date() })
  await audit({ req, userId: req.user!.userId, userName: req.user!.email, action: 'APPROVE', entityType: 'Remboursement', entityId: id, details: { montant: refund.montant } })
  await notifyInApp(refund.requestedById, 'Remboursement visé', `Le remboursement de ${formatAmount(refund.montant)} est visé : rendez l'argent puis enregistrez l'exécution avec la preuve.`, 'INFO', { kind: 'remboursement', refundId: id }, { view: 'remboursements', id })
  res.json({ success: true, data: refund })
})

// PATCH /api/refunds/:id/reject — refus motivé par un viseur
router.patch('/:id/reject', authenticate, requireRole(...VALIDATOR_ROLES), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(10, 'Motif de 10 caractères minimum').max(500) }).parse(req.body)
  const id = String(req.params.id)
  const refund = await transition(id, ['DEMANDE', 'VALIDE'], { statut: 'REJETE', rejectedById: req.user!.userId, rejectedAt: new Date(), rejectionReason: reason })
  await audit({ req, userId: req.user!.userId, userName: req.user!.email, action: 'REJECT', entityType: 'Remboursement', entityId: id, details: { reason } })
  await notifyInApp(refund.requestedById, 'Remboursement refusé', `Le remboursement de ${formatAmount(refund.montant)} est refusé. Motif : ${reason}`, 'ALERTE', { kind: 'remboursement', refundId: id }, { view: 'remboursements', id })
  res.json({ success: true, data: refund })
})

// PATCH /api/refunds/:id/cancel — retrait par le trésorier avant exécution
router.patch('/:id/cancel', authenticate, requireRole('TRESORIER'), async (req, res) => {
  const id = String(req.params.id)
  const refund = await transition(id, ['DEMANDE', 'VALIDE'], { statut: 'ANNULE' })
  await audit({ req, userId: req.user!.userId, userName: req.user!.email, action: 'UPDATE', entityType: 'Remboursement', entityId: id, details: { action: 'annulation' } })
  res.json({ success: true, data: refund })
})

// PATCH /api/refunds/:id/execute — l'argent a été rendu : emplacement d'origine,
// référence et preuve obligatoire (reçu signé, capture du transfert, avis de virement)
router.patch('/:id/execute', authenticate, requireRole('TRESORIER'), receiveProof, async (req, res) => {
  const { sourceLocation, reference } = z.object({
    sourceLocation: z.enum(REFUND_SOURCES, { error: 'Indiquez d\'où l\'argent est sorti' }),
    reference: z.string().trim().max(120).optional(),
  }).parse(req.body)
  const proofType = requireProof(req.file, 'La preuve du remboursement')
  const file = req.file!
  const id = String(req.params.id)
  const pending = await prisma.remboursement.findUnique({ where: { id }, select: { statut: true } })
  if (!pending) throw new AppError('NOT_FOUND', 'Remboursement introuvable', 404)
  if (pending.statut !== 'VALIDE') throw new AppError('BUSINESS_RULE', 'Le remboursement doit d\'abord être visé par un administrateur ou un responsable.', 400)

  const now = new Date()
  const key = `remboursements/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/remboursement-${randomUUID()}.${proofType.ext}`
  const stored = await storeFile(key, file.buffer, proofType.mime, 'private')
  const refund = await transition(id, ['VALIDE'], {
    statut: 'EXECUTE', executedById: req.user!.userId, executedByName: await nameOf(req.user!.userId, req.user!.email), executedAt: now,
    sourceLocation, reference, proofKey: stored.s3Key, proofBucket: stored.s3Bucket, proofMime: proofType.mime, proofName: file.originalname.slice(0, 200), proofSize: file.size,
  })
  await audit({ req, userId: req.user!.userId, userName: req.user!.email, action: 'UPDATE', entityType: 'Remboursement', entityId: id, details: { action: 'execution', montant: refund.montant, sourceLocation, reference: reference ?? null } })
  if (refund.membreId) {
    const membre = await prisma.membre.findUnique({ where: { id: refund.membreId }, select: { userId: true } })
    if (membre) await notifyInApp(membre.userId, 'Remboursement effectué', `Un remboursement de ${formatAmount(refund.montant)} (${MOYEN_LABELS[refund.moyen]}) a été enregistré à votre nom.`, 'INFO', { kind: 'remboursement', refundId: id })
  }
  res.json({ success: true, data: { ...refund, proofKey: undefined, proofBucket: undefined, hasProof: true } })
})

// GET /api/refunds/:id/proof — preuve archivée, jamais d'URL publique
router.get('/:id/proof', authenticate, requireLevel(3), async (req, res) => {
  const refund = await prisma.remboursement.findUnique({ where: { id: String(req.params.id) }, select: { proofKey: true, proofBucket: true, proofMime: true, proofName: true } })
  if (!refund?.proofKey) throw new AppError('NOT_FOUND', 'Aucune preuve pour ce remboursement', 404)
  const file = await getFileStream(refund.proofKey, refund.proofBucket ?? undefined)
  if (!file) throw new AppError('NOT_FOUND', 'Preuve introuvable dans le stockage', 404)
  res.setHeader('Content-Type', refund.proofMime ?? 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(refund.proofName ?? 'preuve-remboursement')}"`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, no-store')
  file.stream.pipe(res)
})

export { router as refundsRouter }
