import 'express-async-errors'
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const user = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }
  const membre = {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }
  const auditLog = { create: vi.fn() }
  const userSession = { deleteMany: vi.fn() }
  const prisma = {
    user,
    membre,
    auditLog,
    userSession,
    $transaction: vi.fn(),
  }
  return {
    prisma,
    user,
    membre,
    auditLog,
    userSession,
    hash: vi.fn(),
    reserveMemberIds: vi.fn(),
    audit: vi.fn(),
  }
})

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(() => mocks.prisma) }))
vi.mock('bcrypt', () => ({ default: { hash: mocks.hash } }))
vi.mock('../src/services/member-id.service', () => ({ reserveMemberIds: mocks.reserveMemberIds }))
vi.mock('../src/services/audit.service', () => ({ audit: mocks.audit }))
vi.mock('../src/middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const role = req.header('x-test-role')
    if (role) req.user = { userId: 'admin-id', role, email: 'admin@example.test' }
    next()
  },
}))

import { membresRouter } from '../src/routes/membres'
import { usersRouter } from '../src/routes/users'
import { errorHandler } from '../src/middleware/errorHandler'

const app = express()
app.use(express.json())
app.use('/api/membres', membresRouter)
app.use('/api/users', usersRouter)
app.use(errorHandler)

const adminUser = {
  id: 'user-id',
  memberId: 'CEM-2026-000001',
  firstName: 'Aline',
  lastName: 'Melen',
  fullName: 'Aline Melen',
  email: 'aline@example.test',
  phone: null,
  role: 'MEMBRE',
  isActive: true,
  mustChangePassword: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

const memberInput = (email: string) => ({
  firstName: 'Aline',
  lastName: 'Melen',
  email,
  categorie: 'MCE_EN_SERVICE',
  groupe: 'TEMPLE',
  statut: 'EN_OBSERVATION',
  profilFinancier: 'TRAVAILLEUR',
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.findUnique.mockResolvedValue(null)
  mocks.user.findMany.mockResolvedValue([])
  mocks.user.create.mockResolvedValue(adminUser)
  mocks.user.update.mockResolvedValue({})
  mocks.membre.findUnique.mockResolvedValue(null)
  mocks.membre.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: `member-${String(data.email)}`,
    memberId: data.memberId,
    user: { fullName: 'Aline Melen', email: data.email, role: 'MEMBRE' },
  }))
  mocks.membre.update.mockResolvedValue({})
  mocks.auditLog.create.mockResolvedValue({})
  mocks.userSession.deleteMany.mockResolvedValue({ count: 0 })
  mocks.hash.mockImplementation(async (raw: string) => `hashed:${raw}`)
  mocks.reserveMemberIds.mockImplementation(async (_tx: unknown, count: number) =>
    Array.from({ length: count }, (_, index) => `CEM-2026-${String(index + 1).padStart(6, '0')}`),
  )
  mocks.audit.mockResolvedValue(undefined)
  mocks.prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
    const tx = {
      user: mocks.user,
      membre: mocks.membre,
      auditLog: mocks.auditLog,
    }
    return callback(tx)
  })
})

describe('provisionnement des mots de passe membre', () => {
  it('crée un compte membre avec un mot de passe individuel haché et à changer', async () => {
    const response = await request(app)
      .post('/api/membres')
      .set('x-test-role', 'RESPONSABLE')
      .send(memberInput('aline@example.test'))

    expect(response.status).toBe(201)
    expect(response.body.success).toBe(true)
    const createdUser = mocks.user.create.mock.calls[0][0].data
    expect(createdUser.passwordHash).toMatch(/^hashed:/)
    expect(createdUser.passwordHash).not.toBe('hashed:ChristEst!2026')
    expect(createdUser.mustChangePassword).toBe(true)
    expect(response.text).not.toContain('ChristEst!2026')
    expect(mocks.reserveMemberIds).toHaveBeenCalledWith(expect.any(Object), 1)
  })

  it('attribue un hash distinct à chaque compte importé sans renvoyer de secrets', async () => {
    const response = await request(app)
      .post('/api/membres/import')
      .set('x-test-role', 'RESPONSABLE')
      .send({ membres: [memberInput('a@example.test'), memberInput('b@example.test')] })

    expect(response.status).toBe(201)
    expect(response.body.meta.imported).toBe(2)
    const createdUsers = mocks.user.create.mock.calls.map(call => call[0].data)
    expect(createdUsers).toHaveLength(2)
    expect(createdUsers[0].passwordHash).not.toBe(createdUsers[1].passwordHash)
    expect(createdUsers.every(user => user.mustChangePassword)).toBe(true)
    expect(response.text).not.toMatch(/ChristEst!2026|temporaryPassword|passwordHash/)
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE',
      entityType: 'MembreImport',
      details: { imported: 2 },
    }), expect.objectContaining({ client: expect.any(Object) }))
    expect(mocks.reserveMemberIds).toHaveBeenCalledWith(expect.any(Object), 2)
  })
})

describe('création et réinitialisation des comptes utilisateurs', () => {
  it('génère une valeur temporaire individuelle à la création et la retourne uniquement dans data', async () => {
    const response = await request(app)
      .post('/api/users')
      .set('x-test-role', 'ADMIN')
      .send({ firstName: 'Aline', lastName: 'Melen', email: 'aline@example.test', role: 'MEMBRE' })

    expect(response.status).toBe(201)
    const rawSecret = response.body.data.temporaryPassword as string
    expect(rawSecret).toBeTruthy()
    expect(response.body.message).not.toContain(rawSecret)
    expect(response.body.data.mustChangePassword).toBe(true)
    expect(mocks.hash).toHaveBeenCalledWith(rawSecret, 12)
    const auditPayload = JSON.stringify(mocks.auditLog.create.mock.calls)
    expect(auditPayload).not.toContain(rawSecret)
    expect(response.headers['cache-control']).toContain('no-store')
  })

  it('génère un nouveau secret temporaire individuel au reset', async () => {
    mocks.user.findUnique.mockResolvedValue({ ...adminUser, id: 'target-id' })
    const response = await request(app)
      .post('/api/users/target-id/reset-password')
      .set('x-test-role', 'ADMIN')
      .send({})

    expect(response.status).toBe(200)
    const rawSecret = response.body.data.temporaryPassword as string
    expect(rawSecret).toBeTruthy()
    expect(response.body.message).not.toContain(rawSecret)
    expect(mocks.hash).toHaveBeenCalledWith(rawSecret, 12)
    expect(mocks.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { passwordHash: `hashed:${rawSecret}`, mustChangePassword: true },
    }))
    expect(response.headers['cache-control']).toContain('no-store')
  })
})
