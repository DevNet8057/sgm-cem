import { describe, it, expect } from 'vitest'
import {
  sanitizeString,
  isValidEmail,
  validatePassword,
  sanitizePhone,
  isValidPhone,
  isValidUrl,
  escapeHtml,
  validateLength,
} from './validation'

describe('sanitizeString', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeString(null)).toBe('')
    expect(sanitizeString(undefined)).toBe('')
  })

  it('trims and escapes HTML entities', () => {
    expect(sanitizeString('  test  ')).toBe('test')
    expect(sanitizeString('<script>')).toBe('&lt;script&gt;')
    expect(sanitizeString('a"b')).toBe('a&quot;b')
    expect(sanitizeString("a'b")).toBe("a&#39;b")
  })
})

describe('isValidEmail', () => {
  it('validates correct emails', () => {
    expect(isValidEmail('test@example.com')).toBe(true)
    expect(isValidEmail('user.name+tag@example.com')).toBe(true)
  })

  it('rejects invalid emails', () => {
    expect(isValidEmail('notanemail')).toBe(false)
    expect(isValidEmail('test@')).toBe(false)
  })
})

describe('validatePassword', () => {
  it('returns valid for strong password', () => {
    const result = validatePassword('Test123@')
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('returns errors for weak password', () => {
    expect(validatePassword('test')).toEqual({
      valid: false,
      errors: ['Le mot de passe doit contenir au moins 8 caractères'],
    })
    expect(validatePassword('abcdefgh')).toEqual({
      valid: false,
      errors: ['Le mot de passe doit contenir au moins une majuscule'],
    })
    expect(validatePassword('Abcdefgh')).toEqual({
      valid: false,
      errors: ['Le mot de passe doit contenir au moins un chiffre'],
    })
  })
})

describe('sanitizePhone', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizePhone(null)).toBe('')
    expect(sanitizePhone(undefined)).toBe('')
  })

  it('keeps only digits and allowed separators', () => {
    expect(sanitizePhone('699-12-34-56')).toBe('699-12-34-56')
    expect(sanitizePhone('+237 699 12 34 56')).toBe('+237 699 12 34 56')
  })
})

describe('isValidPhone', () => {
  it('validates phone with 9-15 digits', () => {
    expect(isValidPhone('699123456')).toBe(true)
    expect(isValidPhone('+237699123456')).toBe(true)
  })

  it('rejects invalid phone', () => {
    expect(isValidPhone('123')).toBe(false)
  })
})

describe('isValidUrl', () => {
  it('validates correct URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true)
    expect(isValidUrl('http://localhost:3000')).toBe(true)
  })

  it('rejects invalid URLs', () => {
    expect(isValidUrl('not-a-url')).toBe(false)
  })
})

describe('escapeHtml', () => {
  it('escapes HTML characters', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
    expect(escapeHtml('a&b')).toBe('a&amp;b')
  })
})

describe('validateLength', () => {
  it('returns valid for correct length', () => {
    expect(validateLength('test', 2, 10, 'test')).toEqual({ valid: true })
  })

  it('returns error for too short', () => {
    expect(validateLength('a', 2, 10, 'test')).toEqual({
      valid: false,
      error: 'test doit contenir au moins 2 caractères',
    })
  })

  it('returns error for too long', () => {
    expect(validateLength('abcdefghijk', 2, 10, 'test')).toEqual({
      valid: false,
      error: 'test ne doit pas dépasser 10 caractères',
    })
  })
})