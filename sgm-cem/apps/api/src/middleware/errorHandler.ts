import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
    public field?: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, field: err.field }
    })
    return
  }

  if (err instanceof ZodError) {
    const field = err.errors[0]?.path.join('.')
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: err.errors[0]?.message ?? 'Validation failed', field }
    })
    return
  }

  console.error('Unhandled error:', err)
  res.status(500).json({
    success: false,
    error: { code: 'SERVER_ERROR', message: 'Une erreur inattendue s\'est produite' }
  })
}
