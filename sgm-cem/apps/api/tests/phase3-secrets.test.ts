// Phase 3.6 — secrets d'intégration chiffrés en base (AES-256-GCM, valeur liée
// à sa clé), chiffrement des valeurs existantes au démarrage, rotation de clé.
import { describe, it, expect, afterAll } from 'vitest'
import { getPrisma } from '../src/lib/prisma'
import { assertEncryptionKeyForProduction, decryptSecret, encryptSecret } from '../src/lib/secret-box'
import { getConfig, loadConfigCache, updateConfig } from '../src/services/config.service'

const prisma = getPrisma()
const KEY = `TEST_SECRET_${Date.now()}`
const CURRENT = process.env.CONFIG_ENCRYPTION_KEY!

afterAll(async () => {
  process.env.CONFIG_ENCRYPTION_KEY = CURRENT
  delete process.env.CONFIG_ENCRYPTION_KEY_PREVIOUS
  await prisma.systemConfigHistory.deleteMany({ where: { configKey: KEY } })
  await prisma.systemConfig.deleteMany({ where: { key: KEY } })
  await loadConfigCache()
})

describe('Secrets chiffrés en base', () => {
  it('une valeur en clair existante est chiffrée au démarrage, lisible par getConfig', async () => {
    await prisma.systemConfig.create({ data: { key: KEY, value: 'cle-api-en-clair', category: 'INTEGRATION_KEYS', label: '[test] secret', isSecret: true } })
    await prisma.systemConfigHistory.create({ data: { configKey: KEY, oldValue: 'ancienne-en-clair', newValue: 'cle-api-en-clair', changedBy: 'test', changedByName: 'test' } })
    await loadConfigCache()
    const row = await prisma.systemConfig.findUniqueOrThrow({ where: { key: KEY } })
    expect(row.value.startsWith('enc:v1:')).toBe(true)
    expect(row.value).not.toContain('cle-api-en-clair')
    expect(getConfig(KEY)).toBe('cle-api-en-clair')
    const history = await prisma.systemConfigHistory.findFirstOrThrow({ where: { configKey: KEY } })
    expect(history.oldValue).not.toContain('ancienne-en-clair')
    expect(history.newValue).not.toContain('cle-api-en-clair')
  })

  it('une modification est chiffrée, historique compris', async () => {
    const someone = await prisma.user.findFirstOrThrow({ select: { id: true, fullName: true } })
    await updateConfig(KEY, 'nouvelle-cle-api', someone, 'rotation')
    const row = await prisma.systemConfig.findUniqueOrThrow({ where: { key: KEY } })
    expect(row.value.startsWith('enc:v1:')).toBe(true)
    expect(getConfig(KEY)).toBe('nouvelle-cle-api')
    const last = await prisma.systemConfigHistory.findFirstOrThrow({ where: { configKey: KEY }, orderBy: { createdAt: 'desc' } })
    expect(decryptSecret(last.newValue, `history:${KEY}`).value).toBe('nouvelle-cle-api')
  })

  it('une valeur chiffrée ne se déchiffre pas sous une autre clé de configuration', () => {
    const sealed = encryptSecret('valeur', 'YELII_COLLECT_API_KEY')
    expect(() => decryptSecret(sealed, 'SMTP_PASS')).toThrow()
  })

  it('rotation : ancienne clé en secours, rechiffrement avec la nouvelle au démarrage', async () => {
    process.env.CONFIG_ENCRYPTION_KEY_PREVIOUS = CURRENT
    process.env.CONFIG_ENCRYPTION_KEY = 'nouvelle-cle-de-chiffrement-de-32-caracteres-min'
    await loadConfigCache()
    expect(getConfig(KEY)).toBe('nouvelle-cle-api')
    delete process.env.CONFIG_ENCRYPTION_KEY_PREVIOUS
    const row = await prisma.systemConfig.findUniqueOrThrow({ where: { key: KEY } })
    expect(decryptSecret(row.value, KEY).value).toBe('nouvelle-cle-api')
    // Retour à la clé de la suite : rechiffrement inverse pour ne rien laisser derrière
    process.env.CONFIG_ENCRYPTION_KEY_PREVIOUS = process.env.CONFIG_ENCRYPTION_KEY
    process.env.CONFIG_ENCRYPTION_KEY = CURRENT
    await loadConfigCache()
    delete process.env.CONFIG_ENCRYPTION_KEY_PREVIOUS
  })

  it('en production, la clé est obligatoire', () => {
    const env = { node: process.env.NODE_ENV, key: process.env.CONFIG_ENCRYPTION_KEY }
    try {
      process.env.NODE_ENV = 'production'
      delete process.env.CONFIG_ENCRYPTION_KEY
      expect(() => assertEncryptionKeyForProduction()).toThrow(/CONFIG_ENCRYPTION_KEY/)
      process.env.CONFIG_ENCRYPTION_KEY = 'trop-courte'
      expect(() => assertEncryptionKeyForProduction()).toThrow()
    } finally {
      process.env.NODE_ENV = env.node
      process.env.CONFIG_ENCRYPTION_KEY = env.key
    }
  })
})
