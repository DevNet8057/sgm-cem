import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'stream'
import fs from 'fs'
import path from 'path'
import { getConfig } from './config.service'

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
  })
  s3Signature = signature
  return s3Client
}

const LOCAL_DIR = path.join(process.cwd(), 'uploads')
const PRIVATE_LOCAL_DIR = path.join(process.cwd(), 'private-uploads')
const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function normalizePrivateKey(key: string): string {
  if (!key || key.includes('\0')) {
    throw new Error('Clé de stockage privée invalide')
  }

  const portableKey = key.replace(/\\/g, '/')
  if (
    path.posix.isAbsolute(portableKey)
    || path.win32.isAbsolute(key)
    || /^[a-zA-Z]:/.test(portableKey)
    || portableKey.split('/').includes('..')
  ) {
    throw new Error('Clé de stockage privée invalide')
  }

  const normalizedKey = path.posix.normalize(portableKey).replace(/^\.\/+/, '')
  if (!normalizedKey || normalizedKey === '.' || normalizedKey.startsWith('../')) {
    throw new Error('Clé de stockage privée invalide')
  }
  return normalizedKey
}

function resolvePrivateLocalPath(key: string): { key: string; filePath: string } {
  const normalizedKey = normalizePrivateKey(key)
  const privateRoot = path.resolve(PRIVATE_LOCAL_DIR)
  const filePath = path.resolve(privateRoot, ...normalizedKey.split('/'))
  const relativePath = path.relative(privateRoot, filePath)

  if (
    !relativePath
    || relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)
  ) {
    throw new Error('Clé de stockage privée invalide')
  }
  return { key: normalizedKey, filePath }
}

function privateMetadataPath(key: string): string {
  return resolvePrivateLocalPath(`${key}.meta.json`).filePath
}

function safeContentType(contentType: string | undefined): string {
  const normalized = contentType?.trim()
  return normalized && /^[\w.+-]+\/[\w.+-]+$/.test(normalized)
    ? normalized
    : DEFAULT_CONTENT_TYPE
}

async function writePrivateLocalFile(
  filePath: string,
  metadataPath: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })

  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const temporaryFilePath = `${filePath}.${suffix}.tmp`
  const temporaryMetadataPath = `${metadataPath}.${suffix}.tmp`

  try {
    await Promise.all([
      fs.promises.writeFile(temporaryFilePath, buffer, { flag: 'wx', mode: 0o600 }),
      fs.promises.writeFile(
        temporaryMetadataPath,
        JSON.stringify({ contentType }),
        { encoding: 'utf8', flag: 'wx', mode: 0o600 }
      ),
    ])
    await fs.promises.rename(temporaryFilePath, filePath)
    await fs.promises.rename(temporaryMetadataPath, metadataPath)
  } finally {
    await Promise.all([
      fs.promises.unlink(temporaryFilePath).catch(() => undefined),
      fs.promises.unlink(temporaryMetadataPath).catch(() => undefined),
    ])
  }
}

export interface StorageResult {
  s3Key: string
  s3Bucket: string
  url: string
  mode: 'S3' | 'local'
}

export interface PrivateStorageResult {
  key: string
  bucket: string
  mode: 'S3' | 'local'
}

/**
 * Upload a file buffer to S3 (or local disk as fallback).
 * Key should be a unique path like "ged/2025/01/doc-xyz.pdf" or "avatars/user-abc.jpg".
 */
export async function storeFile(
  key: string,
  buffer: Buffer,
  mimeType: string
): Promise<StorageResult> {
  const bucket = getConfig('S3_BUCKET_NAME') ?? 'local'
  const client = getS3Client()

  if (client) {
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mimeType })
    )
    const endpoint = getConfig('S3_ENDPOINT')
    const url = endpoint
      ? `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`
      : `https://${bucket}.s3.${getConfig('S3_REGION') ?? 'us-east-1'}.amazonaws.com/${key}`
    return { s3Key: key, s3Bucket: bucket, url, mode: 'S3' }
  }

  // Local fallback — served via GET /uploads/:key
  const localPath = path.join(LOCAL_DIR, key)
  ensureDir(localPath)
  fs.writeFileSync(localPath, buffer)
  const apiUrl = getConfig('API_URL') ?? 'http://localhost:3001'
  return { s3Key: key, s3Bucket: 'local', url: `${apiUrl}/uploads/${key}`, mode: 'local' }
}

/**
 * Stocke un fichier sans générer d'URL publique.
 * Le fallback local reste séparé du répertoire /uploads servi par Express.
 */
export async function storePrivateFile(
  key: string,
  buffer: Buffer,
  mimeType: string
): Promise<PrivateStorageResult> {
  const normalizedKey = normalizePrivateKey(key)
  const bucket = getConfig('S3_BUCKET_NAME') ?? 'local'
  const client = getS3Client()
  const contentType = safeContentType(mimeType)

  if (client) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: normalizedKey,
        Body: buffer,
        ContentType: contentType,
      })
    )
    return { key: normalizedKey, bucket, mode: 'S3' }
  }

  const { filePath } = resolvePrivateLocalPath(normalizedKey)
  const metadataPath = privateMetadataPath(normalizedKey)
  await writePrivateLocalFile(filePath, metadataPath, buffer, contentType)
  return { key: normalizedKey, bucket: 'local', mode: 'local' }
}

/** Stream a file from S3 or local disk. Returns null if not found. */
export async function getFileStream(
  key: string,
  bucket?: string
): Promise<{ stream: Readable; contentType?: string } | null> {
  const bucketName = bucket ?? getConfig('S3_BUCKET_NAME')
  const client = getS3Client()

  if (client && bucketName) {
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

/** Lit un fichier privé depuis S3 ou depuis le stockage local isolé. */
export async function getPrivateFileStream(
  key: string,
  bucket?: string
): Promise<{ stream: Readable; contentType: string } | null> {
  const normalizedKey = normalizePrivateKey(key)
  const client = getS3Client()
  const bucketName = bucket ?? getConfig('S3_BUCKET_NAME')

  if (bucket !== 'local' && client && bucketName) {
    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucketName, Key: normalizedKey })
      )
      if (!response.Body) return null
      return {
        stream: response.Body as Readable,
        contentType: safeContentType(response.ContentType),
      }
    } catch {
      return null
    }
  }

  if (bucket && bucket !== 'local') return null

  const { filePath } = resolvePrivateLocalPath(normalizedKey)
  const metadataPath = privateMetadataPath(normalizedKey)
  try {
    const [stats, rawMetadata] = await Promise.all([
      fs.promises.stat(filePath),
      fs.promises.readFile(metadataPath, 'utf8'),
    ])
    if (!stats.isFile()) return null

    const metadata = JSON.parse(rawMetadata) as { contentType?: string }
    return {
      stream: fs.createReadStream(filePath),
      contentType: safeContentType(metadata.contentType),
    }
  } catch {
    return null
  }
}

/** Delete a stored file. Silent on missing. */
export async function deleteStoredFile(key: string, bucket?: string): Promise<void> {
  const bucketName = bucket ?? getConfig('S3_BUCKET_NAME')
  const client = getS3Client()
  if (client && bucketName) {
    try { await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key })) } catch { /* silent */ }
    return
  }
  const localPath = path.join(LOCAL_DIR, key)
  if (fs.existsSync(localPath)) fs.unlinkSync(localPath)
}

/** Supprime un fichier privé et ses métadonnées locales. */
export async function deletePrivateStoredFile(key: string, bucket?: string): Promise<void> {
  const normalizedKey = normalizePrivateKey(key)
  const client = getS3Client()
  const bucketName = bucket ?? getConfig('S3_BUCKET_NAME')

  if (bucket !== 'local' && client && bucketName) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: normalizedKey }))
    } catch {
      // Suppression idempotente : un objet déjà absent ne bloque pas l'appelant.
    }
    return
  }

  if (bucket && bucket !== 'local') return

  const { filePath } = resolvePrivateLocalPath(normalizedKey)
  const metadataPath = privateMetadataPath(normalizedKey)
  await Promise.all([
    fs.promises.unlink(filePath).catch(() => undefined),
    fs.promises.unlink(metadataPath).catch(() => undefined),
  ])
}

export const storageMode = (): 'S3' | 'local' => (getS3Client() ? 'S3' : 'local')
