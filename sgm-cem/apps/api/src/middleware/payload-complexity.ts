import type { NextFunction, Request, Response } from 'express'
import { AppError } from './errorHandler'

const MAX_ARRAY_LENGTH = 1000
const MAX_NODES = 10000
const MAX_DEPTH = 32

function rejectPayload(): never {
  throw new AppError(
    'PAYLOAD_TOO_COMPLEX',
    'Le contenu de la requête est trop volumineux ou trop complexe.',
    413,
  )
}

// Un budget structurel borne les erreurs que Zod peut accumuler par requête.
export function assertPayloadComplexity(payload: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: payload, depth: 0 }]
  let visited = 0

  while (pending.length > 0) {
    const { value, depth } = pending.pop()!
    visited += 1
    if (visited > MAX_NODES || depth > MAX_DEPTH) rejectPayload()

    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_LENGTH) rejectPayload()
      if (visited + pending.length + value.length > MAX_NODES) rejectPayload()
      for (let index = 0; index < value.length; index += 1) {
        pending.push({ value: value[index], depth: depth + 1 })
      }
    } else if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>
      for (const key in record) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) continue
        if (visited + pending.length >= MAX_NODES) rejectPayload()
        pending.push({ value: record[key], depth: depth + 1 })
      }
    }
  }
}

export function payloadComplexityGuard(req: Request, _res: Response, next: NextFunction): void {
  try {
    assertPayloadComplexity(req.body)
  } catch (error) {
    next(error)
    return
  }
  next()
}
