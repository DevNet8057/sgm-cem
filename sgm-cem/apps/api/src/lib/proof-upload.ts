// Pièces justificatives (reçu de dépôt bancaire, preuve de remboursement) :
// PDF ou photo, 10 Mo maximum, type vérifié sur le contenu du fichier.
import type { NextFunction, Request, Response } from 'express'
import multer from 'multer'
import { AppError } from '../middleware/errorHandler'

export const PROOF_TYPES: Array<{ mime: string; ext: string; magic: (b: Buffer) => boolean }> = [
  { mime: 'application/pdf', ext: 'pdf', magic: b => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/jpeg', ext: 'jpg', magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', magic: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', magic: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
]

const proofUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } })

/** Middleware : fichier du champ `proof` en mémoire (req.file). */
export function receiveProof(req: Request, res: Response, next: NextFunction) {
  proofUpload.single('proof')(req, res, err => {
    if (err) return next(new AppError('VALIDATION_ERROR', err.code === 'LIMIT_FILE_SIZE' ? 'Pièce trop volumineuse (10 Mo maximum)' : 'Fichier illisible', 400))
    next()
  })
}

/** Type réel de la pièce, ou erreur explicite (`label` : « Le reçu de dépôt »…). */
export function requireProof(file: Express.Multer.File | undefined, label: string) {
  if (!file) throw new AppError('VALIDATION_ERROR', `${label} (PDF ou photo) est obligatoire`, 400)
  const type = PROOF_TYPES.find(t => t.magic(file.buffer))
  if (!type) throw new AppError('VALIDATION_ERROR', 'Pièce non reconnue : PDF, JPEG, PNG ou WebP uniquement', 400)
  return type
}
