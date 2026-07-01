import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
    public field?: string,
  ) {
    super(message);
    this.name = "AppError";
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Ensure headers haven't been sent
  if (res.headersSent) {
    return;
  }

  // CSRF token missing or invalid (csrf-csrf throws ForbiddenError with code EBADCSRFTOKEN)
  if (
    (err as { code?: string }).code === 'EBADCSRFTOKEN' ||
    ((err as Error).name === 'ForbiddenError' && (err as { statusCode?: number }).statusCode === 403)
  ) {
    res.status(403).json({
      success: false,
      error: { code: 'CSRF_INVALID', message: 'Jeton CSRF invalide ou manquant' },
    })
    return
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.field && { field: err.field }),
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    const field = err.errors[0]?.path.join(".");
    const message = err.errors[0]?.message ?? "Validation failed";
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message,
        field: String(field),
      },
    });
    return;
  }

  if (err instanceof Error) {
    console.error("Application Error:", {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });

    // Handle specific Node.js errors
    if (err.message.includes("ECONNREFUSED")) {
      res.status(503).json({
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Base de données non disponible",
        },
      });
      return;
    }
  } else {
    console.error("Non-Error thrown:", err);
  }

  res.status(500).json({
    success: false,
    error: {
      code: "SERVER_ERROR",
      message: "Une erreur inattendue s'est produite",
    },
  });
}
