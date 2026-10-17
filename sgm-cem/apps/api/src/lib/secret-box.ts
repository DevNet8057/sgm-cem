// Chiffrement des secrets d'intégration stockés en base (lot 3.6, ADR-011) :
// AES-256-GCM, clé maîtresse dans l'environnement (CONFIG_ENCRYPTION_KEY),
// chaque valeur liée au nom de sa clé (impossible d'échanger deux valeurs).
// Rotation : l'ancienne clé dans CONFIG_ENCRYPTION_KEY_PREVIOUS, les valeurs
// sont rechiffrées avec la nouvelle au démarrage.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

const PREFIX = 'enc:v1:'
const MIN_KEY_LENGTH = 32

function derive(raw: string | undefined): Buffer | null {
  if (!raw || raw.length < MIN_KEY_LENGTH) return null
  return createHash('sha256').update(raw, 'utf8').digest()
}

function currentKey(): Buffer | null {
  return derive(process.env.CONFIG_ENCRYPTION_KEY)
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX)
}

export function hasEncryptionKey(): boolean {
  return currentKey() !== null
}

/** En production, la clé est obligatoire (≥ 32 caractères) : démarrage refusé sinon. */
export function assertEncryptionKeyForProduction(): void {
  if (process.env.NODE_ENV === 'production' && !hasEncryptionKey()) {
    throw new Error('CONFIG_ENCRYPTION_KEY manquante ou trop courte (32 caractères minimum) : obligatoire en production pour chiffrer les secrets en base')
  }
}

/** Chiffre une valeur secrète ; sans clé (développement), la valeur reste en clair. */
export function encryptSecret(plain: string, aad: string): string {
  const key = currentKey()
  if (!key) return plain
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`
}

export type Decrypted = { value: string; needsReencrypt: boolean }

/**
 * Déchiffre une valeur stockée. `needsReencrypt` : valeur encore en clair ou
 * chiffrée avec l'ancienne clé, à rechiffrer avec la clé actuelle.
 * Lève une erreur si aucune clé ne convient (clé perdue ou valeur altérée).
 */
export function decryptSecret(stored: string, aad: string): Decrypted {
  const key = currentKey()
  if (!isEncrypted(stored)) return { value: stored, needsReencrypt: key !== null }
  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(':')
  const attempt = (k: Buffer) => {
    const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(ivB64, 'base64'))
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
  }
  if (key) {
    try { return { value: attempt(key), needsReencrypt: false } } catch { /* essai avec l'ancienne clé */ }
  }
  const previous = derive(process.env.CONFIG_ENCRYPTION_KEY_PREVIOUS)
  if (previous) return { value: attempt(previous), needsReencrypt: key !== null }
  throw new Error('Secret indéchiffrable : CONFIG_ENCRYPTION_KEY absente ou différente de celle du chiffrement')
}
