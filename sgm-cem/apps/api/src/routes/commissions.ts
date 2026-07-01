import { Router } from 'express'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'
import multer from 'multer'
import path from 'path'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { storeFile, getFileStream, deleteStoredFile, storageMode } from '../services/storage'

const router = Router()
const prisma = new PrismaClient()

const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]

const gedUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 Mo max pour GED
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true)
    else cb(new Error('Format non supporté. PDF, Word, Excel ou image uniquement.'))
  },
})

const metaSchema = z.object({
  commissionId: z.string(),
  typeCode: z.string().min(2).max(12),
  titre: z.string().min(3).max(180),
  description: z.string().max(800).optional(),
  tags: z.preprocess(
    (v) => (typeof v === 'string' ? JSON.parse(v) : v),
    z.array(z.string().min(1).max(32)).max(10).optional()
  ),
})

// ── GET commissions ───────────────────────────────────────────────────
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

// Storage mode indicator (so frontend can warn if S3 is not configured)
router.get('/storage-mode', authenticate, requireLevel(1), (_req, res) => {
  res.json({ success: true, data: { mode: storageMode() } })
})

// ── GET documents ─────────────────────────────────────────────────────
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

// ── Download a document file ──────────────────────────────────────────
router.get('/documents/:id/download', authenticate, requireLevel(1), async (req, res) => {
  const doc = await prisma.document.findUnique({ where: { id: String(req.params.id) } })
  if (!doc) throw new AppError('NOT_FOUND', 'Document introuvable', 404)

  const result = await getFileStream(doc.s3Key, doc.s3Bucket)
  if (!result) throw new AppError('NOT_FOUND', 'Fichier introuvable en stockage', 404)

  res.setHeader('Content-Type', result.contentType ?? doc.mimeType)
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.fileName)}"`)
  result.stream.pipe(res)
})

// ── POST upload + create document (multipart/form-data) ───────────────
router.post('/documents', authenticate, requireLevel(2), gedUpload.single('file'), async (req, res) => {
  if (!req.file) throw new AppError('VALIDATION_ERROR', 'Aucun fichier fourni', 400)

  const meta = metaSchema.parse(req.body)

  const [commission, typeDocument] = await Promise.all([
    prisma.commission.findUnique({ where: { id: meta.commissionId } }),
    prisma.typeDocument.findUnique({ where: { code: meta.typeCode } }),
  ])
  if (!commission || !commission.isActive) throw new AppError('NOT_FOUND', 'Commission introuvable', 404)
  if (!typeDocument) throw new AppError('NOT_FOUND', 'Type de document introuvable', 404)

  // Build unique S3 key
  const year = new Date().getFullYear()
  const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
  const key = `ged/${year}/${meta.commissionId}/${Date.now()}-${safeName}`

  const stored = await storeFile(key, req.file.buffer, req.file.mimetype)

  const expiresAt = new Date()
  expiresAt.setFullYear(expiresAt.getFullYear() + typeDocument.retentionAnnees)

  const document = await prisma.document.create({
    data: {
      commissionId: meta.commissionId,
      typeCode: meta.typeCode,
      titre: meta.titre,
      description: meta.description,
      tags: meta.tags ?? [],
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      s3Bucket: stored.s3Bucket,
      s3Key: stored.s3Key,
      uploadedById: req.user!.userId,
      expiresAt,
    },
    include: {
      commission: { select: { nom: true } },
      typeDocument: true,
      uploadedBy: { select: { fullName: true } },
    },
  })

  await audit(req.user!.userId, req.user!.email, 'CREATE', document.id, { titre: document.titre, storageMode: stored.mode })
  res.status(201).json({ success: true, data: document, storageMode: stored.mode })
})

// ── PATCH document status transitions ────────────────────────────────
router.patch('/documents/:id/submit', authenticate, requireLevel(2), async (req, res) => {
  const document = await findDocument(String(req.params.id))
  if (!['BROUILLON', 'REJETE'].includes(document.statut)) {
    throw new AppError('BUSINESS_RULE', 'Ce document ne peut pas être soumis')
  }
  const updated = await updateDocumentStatus(document.id, { statut: 'EN_ATTENTE', rejectedAt: null, rejectedById: null, rejetMotif: null })
  await audit(req.user!.userId, req.user!.email, 'UPDATE', document.id, { statut: 'EN_ATTENTE' })
  res.json({ success: true, data: updated })
})

router.patch('/documents/:id/approve', authenticate, requireLevel(3), async (req, res) => {
  const document = await findDocument(String(req.params.id))
  if (document.statut !== 'EN_ATTENTE') throw new AppError('BUSINESS_RULE', 'Seuls les documents en attente peuvent être approuvés')
  const updated = await updateDocumentStatus(document.id, {
    statut: 'APPROUVE', approvedAt: new Date(), approvedById: req.user!.userId,
  })
  await audit(req.user!.userId, req.user!.email, 'APPROVE', document.id, { titre: document.titre })
  res.json({ success: true, data: updated })
})

router.patch('/documents/:id/reject', authenticate, requireLevel(3), async (req, res) => {
  const { motif } = z.object({ motif: z.string().min(5).max(500) }).parse(req.body)
  const document = await findDocument(String(req.params.id))
  if (document.statut !== 'EN_ATTENTE') throw new AppError('BUSINESS_RULE', 'Seuls les documents en attente peuvent être rejetés')
  const updated = await updateDocumentStatus(document.id, {
    statut: 'REJETE', rejectedAt: new Date(), rejectedById: req.user!.userId, rejetMotif: motif,
  })
  await audit(req.user!.userId, req.user!.email, 'REJECT', document.id, { motif })
  res.json({ success: true, data: updated })
})

router.patch('/documents/:id/archive', authenticate, requireLevel(3), async (req, res) => {
  const document = await findDocument(String(req.params.id))
  if (document.statut === 'ARCHIVE') throw new AppError('BUSINESS_RULE', 'Document déjà archivé')
  const updated = await updateDocumentStatus(document.id, { statut: 'ARCHIVE' })
  await audit(req.user!.userId, req.user!.email, 'UPDATE', document.id, { statut: 'ARCHIVE' })
  res.json({ success: true, data: updated })
})

// ── DELETE document + fichier stocké ─────────────────────────────────
router.delete('/documents/:id', authenticate, requireLevel(3), async (req, res) => {
  const document = await findDocument(String(req.params.id))
  await deleteStoredFile(document.s3Key, document.s3Bucket)
  await prisma.document.delete({ where: { id: document.id } })
  await audit(req.user!.userId, req.user!.email, 'DELETE', document.id, { titre: document.titre })
  res.json({ success: true })
})

// ── Helpers ───────────────────────────────────────────────────────────
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

async function audit(
  userId: string, userName: string,
  action: 'CREATE' | 'UPDATE' | 'APPROVE' | 'REJECT' | 'DELETE',
  entityId: string, details: object
) {
  await prisma.auditLog.create({
    data: { userId, userName, action, entityType: 'Document', entityId, details },
  })
}

export { router as commissionsRouter }
