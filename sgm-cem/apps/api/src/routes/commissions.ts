import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'

const router = Router()
const prisma = new PrismaClient()

const documentSchema = z.object({
  commissionId: z.string(),
  typeCode: z.string().min(2).max(12),
  titre: z.string().min(3).max(180),
  description: z.string().max(800).optional(),
  fileName: z.string().min(3).max(240),
  fileSize: z.number().int().min(1).max(20 * 1024 * 1024),
  mimeType: z.string().min(3).max(120),
  tags: z.array(z.string().min(1).max(32)).max(10).optional(),
})

router.get('/', authenticate, requireLevel(1), async (_req, res) => {
  const commissions = await prisma.commission.findMany({
    where: { isActive: true },
    include: { _count: { select: { documents: true } } },
    orderBy: { nom: 'asc' },
  })
  res.json({ success: true, data: commissions })
})

router.get('/types', authenticate, requireLevel(1), async (_req, res) => {
  const types = await prisma.typeDocument.findMany({ orderBy: { libelle: 'asc' } })
  res.json({ success: true, data: types })
})

router.get('/documents', authenticate, requireLevel(1), async (req, res) => {
  const { commissionId, statut, q } = req.query as Record<string, string>
  const documents = await prisma.document.findMany({
    where: {
      ...(commissionId ? { commissionId } : {}),
      ...(statut ? { statut: statut as never } : {}),
      ...(q ? {
        OR: [
          { titre: { contains: q, mode: 'insensitive' } },
          { fileName: { contains: q, mode: 'insensitive' } },
        ],
      } : {}),
    },
    include: {
      commission: { select: { nom: true } },
      typeDocument: true,
      uploadedBy: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  res.json({ success: true, data: documents })
})

router.get('/:id/documents', authenticate, requireLevel(1), async (req, res) => {
  const documents = await prisma.document.findMany({
    where: { commissionId: String(req.params.id) },
    include: { typeDocument: true, uploadedBy: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ success: true, data: documents })
})

router.post('/documents', authenticate, requireLevel(2), async (req, res) => {
  const data = documentSchema.parse(req.body)
  const [commission, typeDocument] = await Promise.all([
    prisma.commission.findUnique({ where: { id: data.commissionId } }),
    prisma.typeDocument.findUnique({ where: { code: data.typeCode } }),
  ])
  if (!commission || !commission.isActive) throw new AppError('NOT_FOUND', 'Commission introuvable', 404)
  if (!typeDocument) throw new AppError('NOT_FOUND', 'Type de document introuvable', 404)

  const expiresAt = new Date()
  expiresAt.setFullYear(expiresAt.getFullYear() + typeDocument.retentionAnnees)

  const document = await prisma.document.create({
    data: {
      ...data,
      tags: data.tags ?? [],
      uploadedById: req.user!.userId,
      s3Bucket: process.env.S3_BUCKET ?? 'local-ged',
      s3Key: `local/${Date.now()}-${sanitizeFileName(data.fileName)}`,
      expiresAt,
    },
    include: {
      commission: { select: { nom: true } },
      typeDocument: true,
      uploadedBy: { select: { fullName: true } },
    },
  })

  await audit(req.user!.userId, req.user!.email, 'CREATE', document.id, { titre: document.titre })
  res.status(201).json({ success: true, data: document })
})

router.patch('/documents/:id/submit', authenticate, requireLevel(2), async (req, res) => {
  const document = await findDocument(String(req.params.id))
  if (!['BROUILLON', 'REJETE'].includes(document.statut)) {
    throw new AppError('BUSINESS_RULE', 'Ce document ne peut pas etre soumis')
  }
  const updated = await updateDocumentStatus(document.id, { statut: 'EN_ATTENTE', rejectedAt: null, rejectedById: null, rejetMotif: null })
  await audit(req.user!.userId, req.user!.email, 'UPDATE', document.id, { statut: 'EN_ATTENTE' })
  res.json({ success: true, data: updated })
})

router.patch('/documents/:id/approve', authenticate, requireLevel(3), async (req, res) => {
  const document = await findDocument(String(req.params.id))
  if (document.statut !== 'EN_ATTENTE') throw new AppError('BUSINESS_RULE', 'Seuls les documents en attente peuvent etre approuves')
  const updated = await updateDocumentStatus(document.id, {
    statut: 'APPROUVE',
    approvedAt: new Date(),
    approvedById: req.user!.userId,
  })
  await audit(req.user!.userId, req.user!.email, 'APPROVE', document.id, { titre: document.titre })
  res.json({ success: true, data: updated })
})

router.patch('/documents/:id/reject', authenticate, requireLevel(3), async (req, res) => {
  const { motif } = z.object({ motif: z.string().min(5).max(500) }).parse(req.body)
  const document = await findDocument(String(req.params.id))
  if (document.statut !== 'EN_ATTENTE') throw new AppError('BUSINESS_RULE', 'Seuls les documents en attente peuvent etre rejetes')
  const updated = await updateDocumentStatus(document.id, {
    statut: 'REJETE',
    rejectedAt: new Date(),
    rejectedById: req.user!.userId,
    rejetMotif: motif,
  })
  await audit(req.user!.userId, req.user!.email, 'REJECT', document.id, { motif })
  res.json({ success: true, data: updated })
})

router.patch('/documents/:id/archive', authenticate, requireLevel(3), async (req, res) => {
  const document = await findDocument(String(req.params.id))
  if (document.statut === 'ARCHIVE') throw new AppError('BUSINESS_RULE', 'Document deja archive')
  const updated = await updateDocumentStatus(document.id, { statut: 'ARCHIVE' })
  await audit(req.user!.userId, req.user!.email, 'UPDATE', document.id, { statut: 'ARCHIVE' })
  res.json({ success: true, data: updated })
})

async function findDocument(id: string) {
  const document = await prisma.document.findUnique({ where: { id } })
  if (!document) throw new AppError('NOT_FOUND', 'Document introuvable', 404)
  return document
}

async function updateDocumentStatus(id: string, data: Parameters<typeof prisma.document.update>[0]['data']) {
  return prisma.document.update({
    where: { id },
    data,
    include: {
      commission: { select: { nom: true } },
      typeDocument: true,
      uploadedBy: { select: { fullName: true } },
    },
  })
}

async function audit(userId: string, userName: string, action: 'CREATE' | 'UPDATE' | 'APPROVE' | 'REJECT', entityId: string, details: object) {
  await prisma.auditLog.create({
    data: { userId, userName, action, entityType: 'Document', entityId, details },
  })
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export { router as commissionsRouter }
