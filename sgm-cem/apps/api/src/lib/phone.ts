// Numéros de téléphone au format international E.164 (+237…, ou +33… pour la
// diaspora) : une seule écriture en base, quelle que soit la saisie.
import { AppError } from '../middleware/errorHandler'

/**
 * « 677 12 34 56 », « 237677123456 », « +237 677… », « 00237… » → +237677123456 ;
 * « +33 6 12… », « 0033… » ou « 33612… » → +33612… ; un numéro local à 9 chiffres est camerounais.
 */
export function toE164(input: string): string {
  const trimmed = input.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (trimmed.startsWith('+')) return `+${digits}`
  if (digits.startsWith('00')) return `+${digits.slice(2)}`
  if (digits.length === 9) return `+237${digits}` // numéro local camerounais
  // Déjà préfixé de l'indicatif, sans « + » (237…, 33…, 1…)
  if (digits.length >= 10) return `+${digits}`
  return `+237${digits}` // trop court : refusé par isValidE164
}

/** 8 à 15 chiffres après le « + » (norme E.164) ; au Cameroun, exactement 9 après +237. */
export function isValidE164(phone: string): boolean {
  if (phone.startsWith('+237')) return /^\+237\d{9}$/.test(phone)
  return /^\+[1-9]\d{7,14}$/.test(phone)
}

/** Normalise un numéro saisi ; refuse un numéro impossible. Vide → null. */
export function normalizeInputPhone(input: string | null | undefined): string | null | undefined {
  if (input === undefined) return undefined
  if (input === null || input.trim() === '') return null
  const phone = toE164(input)
  if (!isValidE164(phone)) throw new AppError('VALIDATION_ERROR', `Numéro de téléphone invalide : ${input}`, 400, 'phone')
  return phone
}
