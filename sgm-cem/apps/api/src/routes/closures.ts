// Clôture mensuelle (lot 4.2 — EF-M07-09, décision du Bureau) : le trésorier
// présente la position de fin de mois (caisse comptée, banque, portefeuille,
// écarts justifiés), un administrateur la vise. Mois visé : montants figés
// (déclencheur en base) ; les statuts restent modifiables.
import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel, requireRole } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { getPrisma } from '../lib/prisma'
import { formatAmount } from '../lib/utils'
import { audit } from '../services/audit.service'
import { notifyInApp } from '../services/notification'
import { closureFigures, monthBounds } from '../services/closure.service'
import { renderClosurePdf } from '../services/closure-pdf'

const router = Router()
const prisma = getPrisma()

const periodSchema = z.object({
  annee: z.coerce.number().int().min(2020).max(2100),
  mois: z.coerce.number().int().min(1).max(12),
})

function assertMonthEnded(annee: number, mois: number) {
  if (monthBounds(annee, mois).end >= new Date()) throw new AppError('BUSINESS_RULE', 'Ce mois n\'est pas terminé : il ne peut pas encore être clôturé.', 400)
}

// GET /api/closures — historique
router.get('/', authenticate, requireLevel(4), async (_req, res) => {
  const closures = await prisma.clotureMensuelle.findMany({ orderBy: [{ annee: 'desc' }, { mois: 'desc' }], take: 60 })
  res.json({ success: true, data: closures })
})

// GET /api/closures/preview?annee=&mois= — chiffres attendus avant la présentation
router.get('/preview', authenticate, requireLevel(4), async (req, res) => {
  const { annee, mois } = periodSchema.parse(req.query)
  res.json({ success: true, data: await closureFigures(annee, mois) })
})

// POST /api/closures — présentation par le trésorier (nouvelle, ou après un refus)
const presentSchema = periodSchema.extend({
  caisseComptee: z.number().int().min(0),
  soldeBancaire: z.number().int().min(0),
  soldePortefeuille: z.number().int().min(0),
  justification: z.string().trim().max(2000).optional(),
})

router.post('/', authenticate, requireRole('TRESORIER'), async (req, res) => {
  const body = presentSchema.parse(req.body)
  assertMonthEnded(body.annee, body.mois)
  const figures = await closureFigures(body.annee, body.mois)
  const ecart = (body.caisseComptee - figures.attenduCaisse) || (body.soldeBancaire - figures.attenduBanque) || (body.soldePortefeuille - figures.attenduPortefeuille)
  if (ecart !== 0 && (body.justification?.length ?? 0) < 10) {
    throw new AppError('VALIDATION', 'Un écart est constaté : justifiez-le (10 caractères minimum).', 400, 'justification')
  }
  const existing = await prisma.clotureMensuelle.findUnique({ where: { annee_mois: { annee: body.annee, mois: body.mois } } })
  if (existing && existing.statut !== 'REJETEE') throw new AppError('DUPLICATE', `La clôture de ${figures.libelle} est déjà ${existing.statut === 'VALIDEE' ? 'visée' : 'présentée'}.`, 409)

  const presenter = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { fullName: true } })
  const data = {
    statut: 'PRESENTEE' as const,
    positionFin: figures.position as unknown as Prisma.InputJsonValue,
    totalEncaisse: figures.totalEncaisse, totalRembourse: figures.totalRembourse, nbContributions: figures.nbContributions,
    attenduCaisse: figures.attenduCaisse, attenduBanque: figures.attenduBanque, attenduPortefeuille: figures.attenduPortefeuille,
    caisseComptee: body.caisseComptee, soldeBancaire: body.soldeBancaire, soldePortefeuille: body.soldePortefeuille,
    justification: body.justification || null,
    presentedById: req.user!.userId, presentedByName: presenter?.fullName ?? req.user!.email, presentedAt: new Date(),
    validatedById: null, validatedByName: null, validatedAt: null, rejectedById: null, rejectedAt: null, rejectionReason: null,
  }
  const closure = existing
    ? await prisma.clotureMensuelle.update({ where: { id: existing.id }, data })
    : await prisma.clotureMensuelle.create({ data: { annee: body.annee, mois: body.mois, ...data } })

  await audit({ req, userId: req.user!.userId, userName: req.user!.email, action: 'CREATE', entityType: 'ClotureMensuelle', entityId: closure.id, details: { periode: figures.libelle, caisseComptee: body.caisseComptee, soldeBancaire: body.soldeBancaire, soldePortefeuille: body.soldePortefeuille, ecarts: ecart !== 0 } })
  const admins = await prisma.user.findMany({ where: { isActive: true, role: 'ADMIN' }, select: { id: true } })
  await Promise.all(admins.map(a => notifyInApp(a.id, 'Clôture à viser', `${data.presentedByName} présente la clôture de ${figures.libelle} (encaissé : ${formatAmount(figures.totalEncaisse)}).`, 'ALERTE', { kind: 'cloture', closureId: closure.id }, { view: 'clotures', id: closure.id })))
  res.status(201).json({ success: true, data: closure })
})

// PATCH /api/closures/:id/validate — visa d'un administrateur : le mois est clos
router.patch('/:id/validate', authenticate, requireRole('ADMIN'), async (req, res) => {
  const id = String(req.params.id)
  const closure = await prisma.clotureMensuelle.findUnique({ where: { id } })
  if (!closure) throw new AppError('NOT_FOUND', 'Clôture introuvable', 404)
  if (closure.presentedById === req.user!.userId) throw new AppError('FORBIDDEN', 'Le visa doit venir d\'une autre personne que celle qui présente.', 403)
  const validator = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { fullName: true } })
  const result = await prisma.clotureMensuelle.updateMany({
    where: { id, statut: 'PRESENTEE' },
    data: { statut: 'VALIDEE', validatedById: req.user!.userId, validatedByName: validator?.fullName ?? req.user!.email, validatedAt: new Date() },
  })
  if (result.count !== 1) throw new AppError('BUSINESS_RULE', 'Cette clôture a déjà été traitée.', 409)
  const updated = await prisma.clotureMensuelle.findUniqueOrThrow({ where: { id } })
  await audit({ req, userId: req.user!.userId, userName: req.user!.email, action: 'APPROVE', entityType: 'ClotureMensuelle', entityId: id, details: { annee: updated.annee, mois: updated.mois } }, { strict: true })
  await notifyInApp(updated.presentedById, 'Clôture visée', `La clôture de ${updated.mois}/${updated.annee} est visée : les montants du mois sont désormais figés.`, 'INFO', { kind: 'cloture', closureId: id }, { view: 'clotures', id })
  res.json({ success: true, data: updated })
})

// PATCH /api/closures/:id/reject — refus motivé : le trésorier corrige et présente à nouveau
router.patch('/:id/reject', authenticate, requireRole('ADMIN'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(10, 'Motif de 10 caractères minimum').max(500) }).parse(req.body)
  const id = String(req.params.id)
  const result = await prisma.clotureMensuelle.updateMany({
    where: { id, statut: 'PRESENTEE' },
    data: { statut: 'REJETEE', rejectedById: req.user!.userId, rejectedAt: new Date(), rejectionReason: reason },
  })
  if (result.count !== 1) throw new AppError('BUSINESS_RULE', 'Cette clôture a déjà été traitée.', 409)
  const updated = await prisma.clotureMensuelle.findUniqueOrThrow({ where: { id } })
  await audit({ req, userId: req.user!.userId, userName: req.user!.email, action: 'REJECT', entityType: 'ClotureMensuelle', entityId: id, details: { reason } })
  await notifyInApp(updated.presentedById, 'Clôture refusée', `La clôture de ${updated.mois}/${updated.annee} est refusée. Motif : ${reason}`, 'ALERTE', { kind: 'cloture', closureId: id }, { view: 'clotures', id })
  res.json({ success: true, data: updated })
})

// GET /api/closures/:id/pdf — PDF de clôture, produit depuis l'instantané enregistré
router.get('/:id/pdf', authenticate, requireLevel(4), async (req, res) => {
  const closure = await prisma.clotureMensuelle.findUnique({ where: { id: String(req.params.id) } })
  if (!closure) throw new AppError('NOT_FOUND', 'Clôture introuvable', 404)
  const pdf = await renderClosurePdf(closure)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="cloture-${closure.annee}-${String(closure.mois).padStart(2, '0')}.pdf"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(pdf)
})

export { router as closuresRouter }
