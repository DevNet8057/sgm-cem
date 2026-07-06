// Tests du service de configuration centralisé (DEVELOPER_PANEL_SGM_CEM.md §3)
// Vérifie la règle fondamentale : DB source de vérité, .env simple fallback,
// et prise en compte IMMÉDIATE d'un changement sans redémarrage (cache invalidé).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPrisma } from '../src/lib/prisma'
import {
  getConfig,
  getConfigBool,
  getConfigNumber,
  updateConfig,
  loadConfigCache,
  getConfigHistory,
  __clearConfigCacheForTests,
  EXCLUDED_KEYS,
} from '../src/services/config.service'

const prisma = getPrisma()
const TEST_KEY = 'TEST_CONFIG_SERVICE_KEY'
const TEST_ENV_KEY = 'TEST_CONFIG_ENV_ONLY_KEY'

let testUser: { id: string; fullName: string }

beforeAll(async () => {
  // Un utilisateur réel est requis pour l'audit log (FK userId)
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!user) throw new Error('Seed requis : aucun utilisateur en base')
  testUser = { id: user.id, fullName: user.fullName }

  await prisma.systemConfigHistory.deleteMany({ where: { configKey: TEST_KEY } })
  await prisma.systemConfig.deleteMany({ where: { key: TEST_KEY } })
  await prisma.auditLog.deleteMany({ where: { entityType: 'SystemConfig', entityId: TEST_KEY } })
  __clearConfigCacheForTests()
})

afterAll(async () => {
  await prisma.systemConfigHistory.deleteMany({ where: { configKey: TEST_KEY } })
  await prisma.systemConfig.deleteMany({ where: { key: TEST_KEY } })
  await prisma.auditLog.deleteMany({ where: { entityType: 'SystemConfig', entityId: TEST_KEY } })
  delete process.env[TEST_ENV_KEY]
})

describe('config.service — fallback .env', () => {
  it('retombe sur process.env quand la clé est absente de la base', () => {
    process.env[TEST_ENV_KEY] = 'valeur-env'
    expect(getConfig(TEST_ENV_KEY)).toBe('valeur-env')
  })

  it('retourne undefined si fallbackToEnv=false et clé absente de la base', () => {
    expect(getConfig(TEST_ENV_KEY, false)).toBeUndefined()
  })
})

describe('config.service — DB source de vérité + invalidation immédiate', () => {
  it('updateConfig écrit en base et le cache sert la nouvelle valeur SANS rechargement', async () => {
    await updateConfig(TEST_KEY, 'v1', testUser, 'création test', {
      category: 'SYSTEM_BEHAVIOR', label: 'Clé de test',
    })
    // Lecture immédiate depuis le cache — aucun loadConfigCache() ni redémarrage
    expect(getConfig(TEST_KEY)).toBe('v1')

    await updateConfig(TEST_KEY, 'v2', testUser, 'changement test')
    expect(getConfig(TEST_KEY)).toBe('v2')
  })

  it('la valeur DB prime sur process.env pour la même clé', async () => {
    process.env[TEST_KEY] = 'valeur-env-perimee'
    expect(getConfig(TEST_KEY)).toBe('v2') // DB gagne
    delete process.env[TEST_KEY]
  })

  it('loadConfigCache recharge depuis la base après un cache vidé', async () => {
    __clearConfigCacheForTests()
    await loadConfigCache()
    expect(getConfig(TEST_KEY)).toBe('v2')
  })

  it("l'historique conserve chaque changement (plus récent en premier)", async () => {
    const history = await getConfigHistory(TEST_KEY)
    expect(history.length).toBe(2)
    expect(history[0].newValue).toBe('v2')
    expect(history[0].oldValue).toBe('v1')
    expect(history[0].changedByName).toBe(testUser.fullName)
    expect(history[1].newValue).toBe('v1')
    expect(history[1].oldValue).toBeNull()
  })

  it("l'audit log général reçoit DEVELOPER_PANEL_CONFIG_CHANGED", async () => {
    const audits = await prisma.auditLog.findMany({
      where: { entityType: 'SystemConfig', entityId: TEST_KEY },
    })
    expect(audits.length).toBe(2)
    expect(audits.every(a => a.action === 'DEVELOPER_PANEL_CONFIG_CHANGED')).toBe(true)
  })
})

describe('config.service — sécurité', () => {
  it('refuse de stocker les secrets d\'authentification en base', async () => {
    for (const key of ['JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'CSRF_SECRET', 'DATABASE_URL']) {
      expect(EXCLUDED_KEYS.has(key)).toBe(true)
      await expect(updateConfig(key, 'x', testUser)).rejects.toThrow(/interdite en base/)
    }
  })

  it('helpers getConfigBool / getConfigNumber', async () => {
    await updateConfig(TEST_KEY, 'true', testUser)
    expect(getConfigBool(TEST_KEY)).toBe(true)
    await updateConfig(TEST_KEY, '42', testUser)
    expect(getConfigNumber(TEST_KEY, 0)).toBe(42)
    expect(getConfigNumber('CLE_INEXISTANTE_XYZ', 7)).toBe(7)
  })
})
