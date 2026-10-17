import { Router } from 'express'
import { z } from 'zod'
import multer from 'multer'
import path from 'path'
import { authenticate } from '../middleware/auth'
import { requireLevel, ROLE_LEVELS } from '../middleware/rbac'
import type { Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler'
import { storeFile, getFileStream, deleteStoredFile, storageMode } from '../services/storage'
import { getPrisma } from '../lib/prisma'

const router = Router()
const prisma = getPrisma()

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

// Type réel du fichier (EF-M11-01) : contenu comparé au type déclaré
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
function detectFamily(b: Buffer): string | null {
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  if (b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'ooxml'   // .docx, .xlsx
  if (b.subarray(0, 8).equals(OLE)) return 'ole'                                     // .doc, .xls
  return null
}
const FAMILY_OF_MIME: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'image/jpeg', 'image/png': 'image/png', 'image/webp': 'image/webp',
  'application/msword': 'ole', 'application/vnd.ms-excel': 'ole',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'ooxml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'ooxml',
}
function assertRealType(file: Express.Multer.File) {
  if (detectFamily(file.buffer) !== FAMILY_OF_MIME[file.mimetype]) {
    throw new AppError('VALIDATION_ERROR', 'Le contenu du fichier ne correspond pas à son type (PDF, Word, Excel ou image attendus).', 400)
  }
}

// Lecture (EF-M11-03) : tout au niveau 3 et plus ; sinon les documents approuvés,
// les siens et ceux des commissions dont on est responsable
type Viewer = { userId: string; role: string }
const canSeeAll = (u: Viewer) => (ROLE_LEVELS[u.role] ?? 0) >= 3
function documentScope(u: Viewer): Prisma.DocumentWhereInput {
  if (canSeeAll(u)) return {}
  return { OR: [{ statut: 'APPROUVE' }, { uploadedById: u.userId }, { commission: { responsableId: u.userId } }] }
}
async function assertCanSee(u: Viewer, doc: { id: string }) {
  const visible = await prisma.document.count({ where: { AND: [{ id: doc.id }, documentScope(u)] } })
  if (!visible) throw new AppError('NOT_FOUND', 'Document introuvable', 404)
}
// Modifier (soumettre, nouvelle version) : auteur, responsable de la commission ou niveau 3+
async function assertCanEdit(u: Viewer, doc: { uploadedById: string; commissionId: string }) {
  if (canSeeAll(u) || doc.uploadedById === u.userId) return
  const commission = await prisma.commission.findUnique({ where: { id: doc.commissionId }, select: { responsableId: true } })
  if (commission?.responsableId !== u.userId) throw new AppError('FORBIDDEN', 'Seul l\'auteur ou le responsable de la commission peut modifier ce document.', 403)
}

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
router.get('/', authenticate, requireLevel(2), async (_req, res) => {
  const commissions = await prisma.commission.findMany({
    where: { isActive: true },
    include: { _count: { select: { documents: true } } },
    orderBy: { nom: 'asc' },
  })
  res.json({ success: true, data: commissions })
})

router.get('/types', authenticate, requireLevel(2), async (_req, res) => {
  const types = await prisma.typeDocument.findMany({ orderBy: { libelle: 'asc' } })
  res.json({ success: true, data: types })
})

// Storage mode indicator (so frontend can warn if S3 is not configured)
router.get('/storage-mode', authenticate, requireLevel(2), (_req, res) => {
  res.json({ success: true, data: { mode: storageMode() } })
})

// ── GET documents ─────────────────────────────────────────────────────
router.get('/documents', authenticate, requireLevel(2), async (req, res) => {
  const { commissionId, statut, q } = req.query as Record<string, string>
  const documents = await prisma.document.findMany({
    where: {
      ...documentScope(req.user!),
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

router.get('/:id/documents', authenticate, requireLevel(2), async (req, res) => {
  const documents = await prisma.document.findMany({
    where: { AND: [{ commissionId: String(req.params.id) }, documentScope(req.user!)] },
    include: { typeDocument: true, uploadedBy: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ success: true, data: documents })
})

// ── Download a document file ──────────────────────────────────────────
router.get('/documents/:id/download', authenticate, requireLevel(2), async (req, res) => {
  const doc = await prisma.document.findUnique({ where: { id: String(req.params.id) } })
  if (!doc) throw new AppError('NOT_FOUND', 'Document introuvable', 404)
  await assertCanSee(req.user!, doc)

  const result = await getFileStream(doc.s3Key, doc.s3Bucket)
  if (!result) throw new AppError('NOT_FOUND', 'Fichier introuvable en stockage', 404)

  res.setHeader('Content-Type', result.contentType ?? doc.mimeType)
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.fileName)}"`)
  result.stream.pipe(res)
})

// ── POST upload + create document (multipart/form-data) ───────────────
router.post('/documents', authenticate, requireLevel(2), gedUpload.single('file'), async (req, res) => {
  if (!req.file) throw new AppError('VALIDATION_ERROR', 'Aucun fichier fourni', 400)
  assertRealType(req.file)

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
  await assertCanEdit(req.user!, document)
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
  // Une seule version en vigueur : les versions approuvées précédentes sont archivées
  const familyId = document.parentId ?? document.id
  await prisma.document.updateMany({
    where: { id: { not: document.id }, statut: 'APPROUVE', OR: [{ id: familyId }, { parentId: familyId }] },
    data: { statut: 'ARCHIVE' },
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

// ── Versions (EF-M11-05) ─────────────────────────────────────────────
// Nouvelle version : même commission, type et titre ; elle suit le circuit
// (brouillon → soumis → approuvé) et remplace la version en vigueur à l'approbation
router.post('/documents/:id/versions', authenticate, requireLevel(2), gedUpload.single('file'), async (req, res) => {
  if (!req.file) throw new AppError('VALIDATION_ERROR', 'Aucun fichier fourni', 400)
  assertRealType(req.file)
  const source = await findDocument(String(req.params.id))
  await assertCanEdit(req.user!, source)
  const familyId = source.parentId ?? source.id
  const last = await prisma.document.aggregate({ where: { OR: [{ id: familyId }, { parentId: familyId }] }, _max: { version: true } })
  const version = (last._max.version ?? source.version) + 1

  const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
  const stored = await storeFile(`ged/${new Date().getFullYear()}/${source.commissionId}/${Date.now()}-v${version}-${safeName}`, req.file.buffer, req.file.mimetype)
  const document = await prisma.document.create({
    data: {
      commissionId: source.commissionId, typeCode: source.typeCode, titre: source.titre, description: source.description, tags: source.tags,
      fileName: req.file.originalname, fileSize: req.file.size, mimeType: req.file.mimetype, s3Bucket: stored.s3Bucket, s3Key: stored.s3Key,
      uploadedById: req.user!.userId, expiresAt: source.expiresAt, version, parentId: familyId,
    },
    include: { commission: { select: { nom: true } }, typeDocument: true, uploadedBy: { select: { fullName: true } } },
  })
  await audit(req.user!.userId, req.user!.email, 'CREATE', document.id, { titre: document.titre, version, parentId: familyId })
  res.status(201).json({ success: true, data: document })
})

router.get('/documents/:id/versions', authenticate, requireLevel(2), async (req, res) => {
  const source = await findDocument(String(req.params.id))
  await assertCanSee(req.user!, source)
  const familyId = source.parentId ?? source.id
  const versions = await prisma.document.findMany({
    where: { AND: [{ OR: [{ id: familyId }, { parentId: familyId }] }, documentScope(req.user!)] },
    include: { uploadedBy: { select: { fullName: true } } },
    orderBy: { version: 'desc' },
  })
  res.json({ success: true, data: versions })
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
