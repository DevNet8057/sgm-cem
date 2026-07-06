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

export const storageMode = (): 'S3' | 'local' => (getS3Client() ? 'S3' : 'local')
