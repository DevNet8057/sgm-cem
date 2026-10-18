import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'stream'
import fs from 'fs'
import path from 'path'
import { getConfig } from './config.service'
import { logger } from '../lib/logger'

// Client S3 reconstruit si la configuration change depuis le panneau
// développeur (lecture au moment de l'appel, jamais au chargement du module).
let s3Client: S3Client | null = null
let s3Signature = ''

function getS3Client(): S3Client | null {
  const accessKeyId = getConfig('S3_ACCESS_KEY_ID')
  const secretAccessKey = getConfig('S3_SECRET_ACCESS_KEY')
  const bucket = getConfig('S3_BUCKET_NAME')
  if (!accessKeyId || !secretAccessKey || !bucket) return null

  const region = getConfig('S3_REGION') ?? 'auto'
  const endpoint = getConfig('S3_ENDPOINT')
  const signature = `${accessKeyId}|${secretAccessKey}|${region}|${endpoint ?? ''}`
  if (s3Client && signature === s3Signature) return s3Client

  s3Client = new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: !!endpoint, // MinIO / Cloudflare R2
    // Depuis 3.729 le SDK ajoute des sommes de contrôle CRC par défaut, refusées
    // par plusieurs stockages compatibles S3 (R2, Supabase) : uniquement si requis.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
  s3Signature = signature
  return s3Client
}

const LOCAL_DIR = path.join(process.cwd(), 'uploads')

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

export interface StorageResult {
  s3Key: string
  s3Bucket: string
  url: string
  mode: 'S3' | 'local'
}

/**
 * Public : reçus et avatars, servis par lien direct.
 * Privé : GED, preuves de dépôt et de remboursement — jamais de lien public,
 * lus seulement par les routes de téléchargement (droits vérifiés).
 */
export type Visibility = 'public' | 'private'

let privateFallbackWarned = false

/**
 * Upload a file buffer to S3 (or local disk as fallback).
 * Key should be a unique path like "ged/2025/01/doc-xyz.pdf" or "avatars/user-abc.jpg".
 * Un fichier privé va dans S3_PRIVATE_BUCKET_NAME ; sans ce réglage, il reste sur le
 * disque du serveur (volume uploads, jamais servi en direct) plutôt que dans un
 * espace public.
 */
export async function storeFile(
  key: string,
  buffer: Buffer,
  mimeType: string,
  visibility: Visibility = 'public',
): Promise<StorageResult> {
  const privateBucket = getConfig('S3_PRIVATE_BUCKET_NAME')?.trim()
  const bucket = visibility === 'private' ? privateBucket : getConfig('S3_BUCKET_NAME')
  const client = getS3Client()

  if (client && bucket) {
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mimeType })
    )
    if (visibility === 'private') return { s3Key: key, s3Bucket: bucket, url: '', mode: 'S3' }
    const publicUrl = getConfig('S3_PUBLIC_URL')
    const endpoint = getConfig('S3_ENDPOINT')
    const url = publicUrl
      ? `${publicUrl.replace(/\/$/, '')}/${key}`
      : endpoint
      ? `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`
      : `https://${bucket}.s3.${getConfig('S3_REGION') ?? 'us-east-1'}.amazonaws.com/${key}`
    return { s3Key: key, s3Bucket: bucket, url, mode: 'S3' }
  }
  if (client && visibility === 'private' && !privateFallbackWarned) {
    privateFallbackWarned = true
    logger.warn('[Stockage] S3_PRIVATE_BUCKET_NAME non réglé : fichiers privés gardés sur le disque du serveur (volume uploads, à sauvegarder)')
  }

  // Disque local — seuls receipts/ et avatars/ sont servis par /uploads (index.ts)
  const localPath = path.join(LOCAL_DIR, key)
  ensureDir(localPath)
  fs.writeFileSync(localPath, buffer)
  if (visibility === 'private') return { s3Key: key, s3Bucket: 'local', url: '', mode: 'local' }
  const apiUrl = getConfig('API_URL') ?? 'http://localhost:3001'
  return { s3Key: key, s3Bucket: 'local', url: `${apiUrl}/uploads/${key}`, mode: 'local' }
}

/** Retrouve une clé lorsqu'une URL a été produite par ce service. */
export function getManagedStorageKey(url: string): string | null {
  const apiUrl = getConfig('API_URL') ?? 'http://localhost:3001'
  const localPrefix = `${apiUrl.replace(/\/$/, '')}/uploads/`
  if (url.startsWith(localPrefix)) return url.slice(localPrefix.length)

  const publicUrl = getConfig('S3_PUBLIC_URL')
  const publicPrefix = publicUrl ? `${publicUrl.replace(/\/$/, '')}/` : null
  if (publicPrefix && url.startsWith(publicPrefix)) return url.slice(publicPrefix.length)

  return null
}

/** Stream a file from S3 or local disk. Returns null if not found. */
export async function getFileStream(
  key: string,
  bucket?: string
): Promise<{ stream: Readable; contentType?: string } | null> {
  const bucketName = bucket ?? getConfig('S3_BUCKET_NAME')
  const client = getS3Client()

  // Fichier enregistré sur disque (bucket « local ») : lu sur disque même si S3 est réglé depuis
  if (client && bucketName && bucketName !== 'local') {
    try {
      const resp = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }))
      if (!resp.Body) return null
      return { stream: resp.Body as Readable, contentType: resp.ContentType }
    } catch { return null }
  }

  const localPath = path.join(LOCAL_DIR, key)
  if (!fs.existsSync(localPath)) return null
  return { stream: fs.createReadStream(localPath) }
}

/** Delete a stored file. Silent on missing. */
export async function deleteStoredFile(key: string, bucket?: string): Promise<void> {
  const bucketName = bucket ?? getConfig('S3_BUCKET_NAME')
  const client = getS3Client()
  if (client && bucketName && bucketName !== 'local') {
    try { await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key })) } catch { /* silent */ }
    return
  }
  const localPath = path.join(LOCAL_DIR, key)
  if (fs.existsSync(localPath)) fs.unlinkSync(localPath)
}

export const storageMode = (): 'S3' | 'local' => (getS3Client() ? 'S3' : 'local')
