import type { Request } from 'express'
import jwt from 'jsonwebtoken'
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit'
import { getJwtSecret } from '../lib/security'

const RATE_LIMITED = (message: string) => ({ success: false, error: { code: 'RATE_LIMITED', message } })

/**
 * Clé de limitation : l'utilisateur connecté s'il présente un jeton valide
 * (plusieurs membres derrière la même box ou le même opérateur mobile ne se
 * bloquent pas entre eux), sinon l'adresse IP (regroupée par /56 en IPv6).
 */
export function userOrIpKey(req: Request): string {
  const token: string | undefined = req.cookies?.access_token
  if (token) {
    try {
      const { userId } = jwt.verify(token, getJwtSecret()) as { userId: string }
      if (userId) return `u:${userId}`
    } catch { /* jeton invalide → limitation par IP */ }
  }
  return `ip:${ipKeyGenerator(req.ip ?? '0.0.0.0')}`
}

/** Limiteur au format de réponse SGM-CEM ; désactivé en tests automatisés. */
export function limiter(windowMs: number, limit: number, message: string, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: RATE_LIMITED(message),
    skip: () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_IN_TESTS !== '1',
    ...extra,
  })
}

// Global : un écran mobile qui interroge un paiement toutes les 5 s reste très en dessous
export const apiLimiter = limiter(15 * 60 * 1000, 600, 'Trop de requêtes. Réessayez dans quelques minutes.', { keyGenerator: userOrIpKey })
