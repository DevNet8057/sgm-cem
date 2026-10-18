// Reste à faire n° 5 : fichiers privés (GED, preuves) jamais dans l'espace public.
// S3 simulé : aucun appel réel.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import app from '../src/index'
import { getFileStream, storeFile } from '../src/services/storage'

const RUN = `sto-${Date.now()}`
const sent = () => vi.mocked(S3Client.prototype.send).mock.calls.map(c => c[0] as PutObjectCommand)

beforeAll(() => {
  process.env.S3_BUCKET_NAME = 'sgm-public-test'
  process.env.S3_ACCESS_KEY_ID = 'id-test'
  process.env.S3_SECRET_ACCESS_KEY = 'secret-test'
  process.env.S3_PUBLIC_URL = 'https://public.exemple.test'
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.S3_PRIVATE_BUCKET_NAME
})

afterAll(() => {
  for (const k of ['S3_BUCKET_NAME', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL']) delete process.env[k]
  fs.rmSync(path.join(process.cwd(), 'uploads', 'ged', RUN), { recursive: true, force: true })
})

describe('Stockage public / privé', () => {
  it('public : bucket public et lien direct', async () => {
    vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never)
    const r = await storeFile(`receipts/${RUN}.pdf`, Buffer.from('x'), 'application/pdf')
    expect(sent()[0].input.Bucket).toBe('sgm-public-test')
    expect(r.url).toBe(`https://public.exemple.test/receipts/${RUN}.pdf`)
  })

  it('privé avec bucket privé : jamais de lien public', async () => {
    process.env.S3_PRIVATE_BUCKET_NAME = 'sgm-prive-test'
    vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never)
    const r = await storeFile(`ged/${RUN}/pv.pdf`, Buffer.from('x'), 'application/pdf', 'private')
    expect(sent()[0].input.Bucket).toBe('sgm-prive-test')
    expect(r).toMatchObject({ s3Bucket: 'sgm-prive-test', url: '' })
  })

  it('privé sans bucket privé : disque du serveur, pas le bucket public, non servi par /uploads', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never)
    const r = await storeFile(`ged/${RUN}/preuve.pdf`, Buffer.from('preuve'), 'application/pdf', 'private')
    expect(send).not.toHaveBeenCalled()
    expect(r).toMatchObject({ s3Bucket: 'local', url: '', mode: 'local' })
    expect((await request(app).get(`/uploads/ged/${RUN}/preuve.pdf`)).status).toBe(404)
    // Relu sur disque même si S3 est réglé
    const file = await getFileStream(r.s3Key, r.s3Bucket)
    const chunks: Buffer[] = []
    for await (const chunk of file!.stream) chunks.push(chunk as Buffer)
    expect(Buffer.concat(chunks).toString()).toBe('preuve')
    expect(send).not.toHaveBeenCalled()
  })
})
