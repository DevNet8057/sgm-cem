import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createMany: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('dotenv/config', () => ({}))
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    systemConfig = { createMany: mocks.createMany, findMany: mocks.findMany }
    user = { updateMany: mocks.updateMany }
    $disconnect = vi.fn()
  },
}))
vi.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({ systemConfig: { findMany: mocks.findMany } }),
}))

import { main, seedConfig } from '../prisma/seed-config'
import { __clearConfigCacheForTests, getConfig, loadConfigCache } from '../src/services/config.service'

describe('provisionnement de configuration', () => {
  const envSnapshot = new Map<string, string | undefined>()
  const seedEnvKeys = ['SMTP_HOST', 'ADMIN_EMAIL', 'DEVELOPER_EMAIL']

  beforeEach(() => {
    envSnapshot.clear()
    for (const key of seedEnvKeys) {
      envSnapshot.set(key, process.env[key])
      delete process.env[key]
    }
    mocks.createMany.mockReset().mockResolvedValue({ count: 0 })
    mocks.findMany.mockReset().mockResolvedValue([])
    mocks.updateMany.mockReset().mockResolvedValue({ count: 0 })
    __clearConfigCacheForTests()
  })

  afterEach(() => {
    for (const [key, value] of envSnapshot) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('provisionne aussi les clés sans valeur et laisse la base arbitrer les doublons', async () => {
    await seedConfig()

    const call = mocks.createMany.mock.calls[0][0]
    const configs = call.data as Array<{ key: string; value: string; isSecret: boolean }>
    expect(call.skipDuplicates).toBe(true)
    expect(configs.find(config => config.key === 'SMTP_HOST')?.value).toBe('')
    expect(configs.find(config => config.key === 'FEATURE_PERCENT_DISTRIBUTION')?.value).toBe('false')
    expect(configs.find(config => config.key === 'SMTP_PASS')?.isSecret).toBe(true)
    expect(configs.some(config => config.key === 'JWT_SECRET')).toBe(false)
    expect(configs.some(config => config.key === 'REFRESH_TOKEN_SECRET')).toBe(false)
    expect(configs.some(config => config.key === 'CSRF_SECRET')).toBe(false)
    expect(configs.some(config => config.key === 'DATABASE_URL')).toBe(false)
  })

  it('ne promeut aucun compte pendant une synchronisation ordinaire', async () => {
    const originalArgs = process.argv
    process.argv = originalArgs.filter(argument => argument !== '--bootstrap-developer')
    try {
      await main()
    } finally {
      process.argv = originalArgs
    }
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })

  it('n’élève que le compte ADMIN cible pendant le bootstrap explicite', async () => {
    const originalArgs = process.argv
    const originalAdminEmail = process.env.ADMIN_EMAIL
    process.argv = [...originalArgs, '--bootstrap-developer']
    process.env.ADMIN_EMAIL = 'admin-test@example.invalid'
    process.env.DEVELOPER_EMAIL = 'developer-test@example.invalid'
    try {
      await main()
    } finally {
      process.argv = originalArgs
      if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL
      else process.env.ADMIN_EMAIL = originalAdminEmail
    }
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { email: 'developer-test@example.invalid', role: 'ADMIN' },
      data: { role: 'DEVELOPER' },
    })
  })
})

describe('fallback runtime de configuration', () => {
  const envKey = 'TEST_CONFIG_PROVISION_FALLBACK'

  beforeEach(() => {
    __clearConfigCacheForTests()
    mocks.findMany.mockReset().mockResolvedValue([])
    delete process.env[envKey]
  })

  it('utilise .env quand une ligne DB est vide et respecte fallbackToEnv=false', async () => {
    mocks.findMany.mockResolvedValue([{ key: envKey, value: '' }])
    process.env[envKey] = 'valeur-env'

    await loadConfigCache()

    expect(getConfig(envKey)).toBe('valeur-env')
    expect(getConfig(envKey, false)).toBeUndefined()
  })

  it('conserve les valeurs DB false et zéro comme source de vérité', async () => {
    mocks.findMany.mockResolvedValue([
      { key: `${envKey}_FALSE`, value: 'false' },
      { key: `${envKey}_ZERO`, value: '0' },
    ])
    process.env[`${envKey}_FALSE`] = 'true'
    process.env[`${envKey}_ZERO`] = '12'

    await loadConfigCache()

    expect(getConfig(`${envKey}_FALSE`)).toBe('false')
    expect(getConfig(`${envKey}_ZERO`)).toBe('0')
    delete process.env[`${envKey}_FALSE`]
    delete process.env[`${envKey}_ZERO`]
  })
})
