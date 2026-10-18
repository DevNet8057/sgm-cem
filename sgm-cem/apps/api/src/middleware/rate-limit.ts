import type { Request } from 'express'
import jwt from 'jsonwebtoken'
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit'
import { getJwtSecret } from '../lib/security'
import { createHash } from 'crypto'
import IORedis from 'ioredis'
import { RedisStore, type RedisReply } from 'rate-limit-redis'

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

// Compteurs partagés dans Redis quand il est configuré : plusieurs processus API
// appliquent la même limite et un redémarrage ne la remet pas à zéro.
let redis: IORedis | null = null
function sharedRedis(): IORedis | null {
  const url = process.env.REDIS_URL
  if (!url) return null
  // Les limiteurs sont créés pendant le chargement de l'application, avant que
  // la connexion Redis asynchrone soit prête. Garder la file d'attente active
  // évite un rejet synchrone au démarrage ; express-rate-limit reste en mode
  // dégradé grâce à passOnStoreError si Redis devient réellement indisponible.
  redis ??= new IORedis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: true })
  return redis
}

/** Limiteur au format de réponse SGM-CEM ; désactivé en tests automatisés. */
export function limiter(windowMs: number, limit: number, message: string, extra: Partial<Options> = {}) {
  const client = sharedRedis()
  // Préfixe stable d'un processus à l'autre : dérivé de la définition du limiteur
  const prefix = `rl:${createHash('sha1').update(`${windowMs}|${limit}|${message}`).digest('hex').slice(0, 12)}:`
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: RATE_LIMITED(message),
    skip: () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_IN_TESTS !== '1',
    ...(client && {
      store: new RedisStore({ prefix, sendCommand: (command: string, ...args: string[]) => client.call(command, ...args) as Promise<RedisReply> }),
      // Redis indisponible : la requête passe plutôt que de bloquer tout le monde
      passOnStoreError: true,
    }),
    ...extra,
  })
}

// Global : un écran mobile qui interroge un paiement toutes les 5 s reste très en dessous
export const apiLimiter = limiter(15 * 60 * 1000, 600, 'Trop de requêtes. Réessayez dans quelques minutes.', { keyGenerator: userOrIpKey })
