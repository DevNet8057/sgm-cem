// Documents PDF ajoutés à la refonte : relevé annuel d'un membre, facture de
// prestation, avis de remboursement (gabarit commun, services/documents).
import { Router, type Response } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { getPrisma } from '../lib/prisma'
import { audit } from '../services/audit.service'
import { generateMemberStatementPdf, generatePrestationInvoicePdf, generateRefundNoticePdf } from '../services/documents/extra-documents'

const router = Router()
const prisma = getPrisma()

const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()) })

function sendPdf(res: Response, pdf: Buffer, filename: string, download: unknown) {
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${download === '1' ? 'attachment' : 'inline'}; filename="${filename}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(pdf)
}

// Relevé annuel du membre connecté
router.get('/releve/me', authenticate, requireLevel(1), async (req, res) => {
  const { year } = yearQuery.parse(req.query)
  const membre = await prisma.membre.findFirst({ where: { userId: req.user!.userId }, select: { id: true } })
  if (!membre) throw new AppError('NOT_FOUND', 'Profil membre introuvable pour ce compte', 404)
  sendPdf(res, await generateMemberStatementPdf(membre.id, year), `Releve-${year}.pdf`, req.query.download)
})

// Relevé annuel d'un membre, par un responsable (journalisé : données personnelles)
router.get('/releve/:membreId', authenticate, requireLevel(3), async (req, res) => {
  const { year } = yearQuery.parse(req.query)
  const membreId = String(req.params.membreId)
  const membre = await prisma.membre.findUnique({ where: { id: membreId }, select: { memberId: true } })
  if (!membre) throw new AppError('NOT_FOUND', 'Membre introuvable', 404)
  const pdf = await generateMemberStatementPdf(membreId, year)
  await audit({ req, userId: req.user!.userId, userName: req.user!.email, action: 'EXPORT', entityType: 'Membre', entityId: membreId, details: { document: 'releve-annuel', year } })
  sendPdf(res, pdf, `Releve-${membre.memberId}-${year}.pdf`, req.query.download)
})

router.get('/prestations/:id/facture', authenticate, requireLevel(3), async (req, res) => {
  const p = await prisma.prestation.findUnique({ where: { id: String(req.params.id) }, select: { id: true, reference: true } })
  if (!p) throw new AppError('NOT_FOUND', 'Prestation introuvable', 404)
  sendPdf(res, await generatePrestationInvoicePdf(p.id), `Facture-${p.reference}.pdf`, req.query.download)
})

router.get('/remboursements/:id/avis', authenticate, requireLevel(3), async (req, res) => {
  const r = await prisma.remboursement.findUnique({ where: { id: String(req.params.id) }, select: { id: true } })
  if (!r) throw new AppError('NOT_FOUND', 'Remboursement introuvable', 404)
  sendPdf(res, await generateRefundNoticePdf(r.id), 'Avis-de-remboursement.pdf', req.query.download)
})

export { router as documentsRouter }
