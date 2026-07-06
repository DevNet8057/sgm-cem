// ──────────────────────────────────────────────────────────────────────
// SERVICE DE CONFIGURATION CENTRALISÉ — DEVELOPER_PANEL_SGM_CEM.md §3
//
// La base de données (table system_configs) est la SOURCE DE VÉRITÉ à
// l'exécution. Le .env n'est qu'une valeur de secours au premier démarrage.
//
// Règles :
//   • Aucun fichier métier ne doit lire process.env.YELII_* directement —
//     tout passe par getConfig(), APPELÉ AU MOMENT DE L'USAGE (jamais de
//     constante figée au chargement du module, sinon un changement depuis
//     le panneau développeur n'aurait d'effet qu'après redémarrage).
//   • JAMAIS dans cette table : JWT_SECRET, REFRESH_TOKEN_SECRET,
//     CSRF_SECRET, DATABASE_URL (voir EXCLUDED_KEYS).
// ──────────────────────────────────────────────────────────────────────

import { getPrisma } from '../lib/prisma'

const prisma = getPrisma()

// Secrets dont la fuite compromettrait l'authentification du système entier :
// ils restent dans .env, ne vont jamais en base, ne sont jamais affichés.
export const EXCLUDED_KEYS = new Set([
  'JWT_SECRET',
  'REFRESH_TOKEN_SECRET',
  'CSRF_SECRET',
  'DATABASE_URL',
])

// Cache en mémoire pour éviter une requête DB à chaque appel.
// Invalidé immédiatement quand une valeur est modifiée (voir updateConfig).
const configCache = new Map<string, string>()
let cacheLoaded = false

/**
 * Charge toute la configuration en cache au démarrage du serveur.
 * Appelée une fois dans apps/api/src/index.ts.
 * Tolérante aux erreurs : si la table n'existe pas encore (premier démarrage),
 * getConfig() retombe sur .env.
 */
export async function loadConfigCache(): Promise<void> {
  try {
    const configs = await prisma.systemConfig.findMany()
    configCache.clear()
    configs.forEach(c => configCache.set(c.key, c.value))
    cacheLoaded = true
    console.log(`[Config] ${configs.length} paramètres chargés en cache`)
  } catch (err) {
    console.error('[Config] Échec du chargement du cache — fallback .env', err)
  }
}

export function isConfigCacheLoaded(): boolean {
  return cacheLoaded
}

/**
 * Lit une valeur de configuration.
 * Priorité : 1. base de données (cache) → 2. .env (fallback) → undefined.
 *
 * C'EST CETTE FONCTION QUI REMPLACE process.env.XXX DANS LE CODE MÉTIER.
 * Synchrone (lecture cache) pour pouvoir être appelée partout.
 */
export function getConfig(key: string, fallbackToEnv = true): string | undefined {
  if (configCache.has(key)) {
    return configCache.get(key)
  }
  if (fallbackToEnv && process.env[key]) {
    return process.env[key]
  }
  return undefined
}

/** Variante avec valeur par défaut explicite. */
export function getConfigOr(key: string, defaultValue: string): string {
  return getConfig(key) ?? defaultValue
}

/** Interprète une config comme booléen ("true"/"1"/"on" → true). */
export function getConfigBool(key: string, defaultValue = false): boolean {
  const raw = getConfig(key)
  if (raw === undefined) return defaultValue
  return ['true', '1', 'on', 'yes'].includes(raw.trim().toLowerCase())
}

/** Interprète une config comme nombre ; defaultValue si absent/invalide. */
export function getConfigNumber(key: string, defaultValue: number): number {
  const raw = getConfig(key)
  if (raw === undefined) return defaultValue
  const n = Number(raw)
  return Number.isFinite(n) ? n : defaultValue
}

export interface ConfigMeta {
  category?: 'WEBHOOKS' | 'INTEGRATION_KEYS' | 'FINANCIAL' | 'INFRASTRUCTURE' | 'SYSTEM_BEHAVIOR' | 'NOTIFICATIONS' | 'FEATURE_FLAGS'
  label?: string
  description?: string
  isSecret?: boolean
}

/**
 * Modifie une valeur de configuration.
 * Écrit en base + historique + audit log (action DEVELOPER_PANEL_CONFIG_CHANGED),
 * puis invalide le cache immédiatement — pas besoin de redémarrer le serveur.
 */
export async function updateConfig(
  key: string,
  newValue: string,
  changedBy: { id: string; fullName: string },
  reason?: string,
  meta?: ConfigMeta
): Promise<void> {
  if (EXCLUDED_KEYS.has(key)) {
    throw new Error(`La clé ${key} est un secret d'authentification : interdite en base (uniquement .env)`)
  }

  const existing = await prisma.systemConfig.findUnique({ where: { key } })
  if (existing && !existing.isEditable) {
    throw new Error(`La clé ${key} n'est pas éditable manuellement`)
  }

  await prisma.$transaction([
    prisma.systemConfig.upsert({
      where: { key },
      update: { value: newValue, updatedBy: changedBy.id },
      create: {
        key,
        value: newValue,
        category: meta?.category ?? 'INFRASTRUCTURE',
        label: meta?.label ?? key,
        description: meta?.description,
        isSecret: meta?.isSecret ?? false,
        updatedBy: changedBy.id,
      },
    }),
    prisma.systemConfigHistory.create({
      data: {
        configKey: key,
        oldValue: existing?.value,
        newValue,
        changedBy: changedBy.id,
        changedByName: changedBy.fullName,
        reason,
      },
    }),
    // Audit général (§7) — adapté au modèle AuditLog réel du repo
    // (entityType + details Json, pas entity/before/after)
    prisma.auditLog.create({
      data: {
        userId: changedBy.id,
        userName: changedBy.fullName,
        action: 'DEVELOPER_PANEL_CONFIG_CHANGED',
        entityType: 'SystemConfig',
        entityId: key,
        details: {
          // Ne jamais consigner un secret en clair dans l'audit
          before: existing?.isSecret ? '••••' : existing?.value ?? null,
          after: (existing?.isSecret ?? meta?.isSecret) ? '••••' : newValue,
          reason: reason ?? null,
        },
      },
    }),
  ])

  // Invalidation immédiate du cache — le prochain getConfig() lit la nouvelle valeur
  configCache.set(key, newValue)
}

/**
 * Historique complet des changements d'une clé (affichage panneau développeur).
 */
export async function getConfigHistory(key: string) {
  return prisma.systemConfigHistory.findMany({
    where: { configKey: key },
    orderBy: { createdAt: 'desc' },
  })
}

/** Réservé aux tests : vider le cache pour simuler un premier démarrage. */
export function __clearConfigCacheForTests(): void {
  configCache.clear()
  cacheLoaded = false
}
