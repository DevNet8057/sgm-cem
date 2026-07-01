import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'stream'
import fs from 'fs'
import path from 'path'

const hasS3 = !!(
  process.env.S3_ACCESS_KEY_ID &&
  process.env.S3_SECRET_ACCESS_KEY &&
  process.env.S3_BUCKET_NAME
)

const s3Client = hasS3
  ? new S3Client({
      region: process.env.S3_REGION ?? 'auto',
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: !!process.env.S3_ENDPOINT, // MinIO / Cloudflare R2
    })
  : null

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
  const bucket = process.env.S3_BUCKET_NAME ?? 'local'

  if (s3Client) {
    await s3Client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mimeType })
    )
    const endpoint = process.env.S3_ENDPOINT
    const url = endpoint
      ? `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`
      : `https://${bucket}.s3.${process.env.S3_REGION ?? 'us-east-1'}.amazonaws.com/${key}`
    return { s3Key: key, s3Bucket: bucket, url, mode: 'S3' }
  }

  // Local fallback — served via GET /uploads/:key
  const localPath = path.join(LOCAL_DIR, key)
  ensureDir(localPath)
  fs.writeFileSync(localPath, buffer)
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  return { s3Key: key, s3Bucket: 'local', url: `${apiUrl}/uploads/${key}`, mode: 'local' }
}

/** Stream a file from S3 or local disk. Returns null if not found. */
export async function getFileStream(
  key: string,
  bucket?: string
): Promise<{ stream: Readable; contentType?: string } | null> {
  const bucketName = bucket ?? process.env.S3_BUCKET_NAME

  if (s3Client && bucketName) {
    try {
      const resp = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }))
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
  const bucketName = bucket ?? process.env.S3_BUCKET_NAME
  if (s3Client && bucketName) {
    try { await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key })) } catch { /* silent */ }
    return
  }
  const localPath = path.join(LOCAL_DIR, key)
  if (fs.existsSync(localPath)) fs.unlinkSync(localPath)
}

export const storageMode = (): 'S3' | 'local' => (s3Client ? 'S3' : 'local')
