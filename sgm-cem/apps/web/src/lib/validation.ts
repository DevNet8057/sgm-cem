/**
 * Input validation and sanitization utilities
 * Prevents XSS, SQL injection, and other injection attacks
 */

/**
 * Sanitize string input by removing/escaping potentially dangerous characters
 */
export function sanitizeString(input: string | undefined | null): string {
  if (!input) return ''
  return String(input)
    .trim()
    .replace(/[<>\"']/g, (char) => ({
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char] || char))
}

/**
 * Validate email format (RFC 5322 simplified)
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email) && email.length <= 255
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!password || password.length < 8) {
    errors.push('Le mot de passe doit contenir au moins 8 caractères')
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Le mot de passe doit contenir au moins une majuscule')
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Le mot de passe doit contenir au moins un chiffre')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Sanitize phone number (keep only digits and allowed separators)
 */
export function sanitizePhone(phone: string | undefined | null): string {
  if (!phone) return ''
  return String(phone).replace(/[^\d\s\-\+\(\)]/g, '').trim()
}

/**
 * Validate phone format (basic)
 */
export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 9 && digits.length <= 15
}

/**
 * Validate URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * Escape HTML entities (for safe display)
 */
export function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return text.replace(/[&<>"']/g, (char) => map[char] || char)
}

/**
 * Validate input length
 */
export function validateLength(
  input: string | undefined | null,
  minLength: number,
  maxLength: number,
  fieldName: string
): { valid: boolean; error?: string } {
  const value = input?.trim() ?? ''

  if (value.length < minLength) {
    return {
      valid: false,
      error: `${fieldName} doit contenir au moins ${minLength} caractères`,
    }
  }

  if (value.length > maxLength) {
    return {
      valid: false,
      error: `${fieldName} ne doit pas dépasser ${maxLength} caractères`,
    }
  }

  return { valid: true }
}
