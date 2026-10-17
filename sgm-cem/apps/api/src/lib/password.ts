import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2'
import bcrypt from 'bcryptjs'
import { randomInt } from 'crypto'

// Argon2id, paramètres OWASP 2025 (19 Mio, 2 passes) — supportables sur un petit serveur.
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const

// Hash factice : compte inexistant → même coût de calcul (pas d'énumération par chronométrage).
let dummyHash: Promise<string> | null = null

export function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTIONS)
}

function isBcryptHash(stored: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(stored)
}

/**
 * Vérifie un mot de passe contre un hash Argon2id (actuel) ou bcrypt (comptes
 * existants). Ne lève jamais : un hash inconnu ou désactivé renvoie false.
 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    dummyHash ??= hashPassword('compte-inexistant')
    await argon2Verify(await dummyHash, password).catch(() => false)
    return false
  }
  try {
    if (stored.startsWith('$argon2')) return await argon2Verify(stored, password)
    if (isBcryptHash(stored)) return await bcrypt.compare(password, stored)
  } catch {
    return false
  }
  return false
}

/** Vrai si le hash doit être recalculé en Argon2id après une connexion réussie. */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith('$argon2id$') || !stored.includes(`m=${ARGON2_OPTIONS.memoryCost},t=${ARGON2_OPTIONS.timeCost},`)
}

// Sans caractères ambigus (0/O, 1/l/I) : le mot de passe est souvent dicté ou recopié.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/** Mot de passe temporaire aléatoire (12 caractères + suffixe garantissant la politique). */
export function generateTemporaryPassword(): string {
  let out = ''
  for (let i = 0; i < 12; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return `${out}-${randomInt(10, 100)}`
}
