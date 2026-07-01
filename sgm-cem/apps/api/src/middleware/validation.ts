import { Request, Response, NextFunction } from 'express'
import { z, ZodError } from 'zod'

/**
 * Validation middleware factory
 * Validates request body, query, or params against a Zod schema
 */
export function validate(schema: z.ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dataToValidate = source === 'body' ? req.body : source === 'query' ? req.query : req.params
      const validated = await schema.parseAsync(dataToValidate)

      // Replace the original data with validated data
      if (source === 'body') req.body = validated
      else if (source === 'query') req.query = validated
      else req.params = validated

      next()
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        }))
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: errors,
          },
        })
      }
      next(error)
    }
  }
}

/**
 * Sanitization schemas for common fields
 */
export const sanitizationSchemas = {
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(8).max(255),
  firstName: z.string().min(1).max(100).trim(),
  lastName: z.string().min(1).max(100).trim(),
  phone: z.string().regex(/^[\d\s\-\+\(\)]+$/).optional().nullable(),
  url: z.string().url().optional().nullable(),
}

/**
 * Authentication payload schema
 */
export const loginSchema = z.object({
  email: sanitizationSchemas.email,
  password: z.string().min(1),
})

/**
 * Password change schema
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: sanitizationSchemas.password,
})

/**
 * Profile update schema
 */
export const profileUpdateSchema = z.object({
  firstName: sanitizationSchemas.firstName.optional(),
  lastName: sanitizationSchemas.lastName.optional(),
  email: sanitizationSchemas.email.optional(),
  phone: sanitizationSchemas.phone,
  whatsappPhone: sanitizationSchemas.phone,
}).strict()

/**
 * User creation schema
 */
export const userCreateSchema = z.object({
  firstName: sanitizationSchemas.firstName,
  lastName: sanitizationSchemas.lastName,
  email: sanitizationSchemas.email,
  role: z.enum(['ADMIN', 'TRESORIER', 'RESPONSABLE', 'ADJOINT_RESPONSABLE', 'COLLECTEUR', 'MEMBRE']),
  phone: sanitizationSchemas.phone,
  password: z.string().optional().nullable(),
}).strict()
