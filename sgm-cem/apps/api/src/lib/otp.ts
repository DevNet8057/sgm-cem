import { createHmac, randomInt, timingSafeEqual } from 'crypto'
import { getJwtSecret } from './security'
import { toE164 } from './phone'

export const OTP_TTL_MS = 5 * 60 * 1000
// Au-delà, plus aucun code n'est envoyé à ce numéro pendant une heure (anti-bombardement SMS)
export const OTP_MAX_PER_PHONE_PER_HOUR = 5
// Essais de saisie par code ; au-delà, le code est invalidé
export const OTP_MAX_ATTEMPTS = 3

/** Code à 6 chiffres tiré d'un générateur cryptographique. */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Le code n'est jamais stocké en clair : empreinte liée au numéro et à l'usage. */
export function hashOtpCode(phone: string, purpose: string, code: string): string {
  return createHmac('sha256', getJwtSecret()).update(`${purpose}:${phone}:${code}`).digest('hex')
}

export function otpMatches(stored: string, phone: string, purpose: string, code: string): boolean {
  const expected = Buffer.from(hashOtpCode(phone, purpose, code), 'hex')
  const actual = Buffer.from(stored, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/**
 * Numéro au format E.164 (`full`) et formats sous lesquels il a pu être enregistré
 * avant la normalisation (`all`, recherche des anciens comptes).
 */
export function phoneVariants(phone: string): { normalized: string; full: string; all: string[] } {
  const full = toE164(phone)
  const normalized = full.slice(1)
  const legacy = normalized.startsWith('237') ? [normalized.slice(3), normalized] : [normalized]
  return { normalized, full, all: [...new Set([phone, ...legacy, full])] }
}
