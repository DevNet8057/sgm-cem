// Contrats publics et contrôle d'accès SMTP, sans démarrer l'application ni sa base.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const { getConfigMock, verifySmtpMock, auditMock, findUserMock, findConfigsMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  verifySmtpMock: vi.fn(),
  auditMock: vi.fn(),
  findUserMock: vi.fn(),
  findConfigsMock: vi.fn(),
}))

vi.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    user: { findUnique: findUserMock },
    systemConfig: { findMany: findConfigsMock },
  }),
}))

vi.mock('../src/middleware/auth', () => ({
  authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = req.header('x-test-role')
    if (!role) {
      res.status(401).json({ success: false, error: { code: 'ACCESS_DENIED', message: 'Token manquant' } })
      return
    }
    req.user = { userId: 'test-user', role, email: 'test@example.com' }
    next()
  },
}))

vi.mock('../src/services/config.service', () => ({
  getConfig: getConfigMock,
  getConfigBool: vi.fn(),
  getConfigNumber: vi.fn(),
  updateConfig: vi.fn(),
  getConfigHistory: vi.fn(),
  EXCLUDED_KEYS: new Set(),
}))

vi.mock('../src/services/email', () => ({ verifySmtpConnection: verifySmtpMock }))
vi.mock('../src/services/audit.service', () => ({ audit: auditMock }))
vi.mock('../src/services/yelii.service', () => ({
  getYeliiWalletBalance: vi.fn(),
  initiateYeliiPayment: vi.fn(),
}))
vi.mock('../src/services/cinetpay.service', () => ({
  initiateCinetpayPayment: vi.fn(),
  isCinetpayConfigured: vi.fn(),
}))
vi.mock('../src/services/payment-status.service', () => ({
  syncYeliiContributionStatus: vi.fn(),
  CONTRIBUTION_SYNC_SELECT: {},
}))
vi.mock('../src/services/collecte.service', () => ({
  buildDynamicSchema: vi.fn(),
  generateDraftToken: vi.fn(),
  hashDraftToken: vi.fn(),
  normalizePhone: vi.fn(),
}))
vi.mock('../src/routes/auth', () => ({ setAuthCookies: vi.fn() }))

import 'express-async-errors'
import { publicRouter } from '../src/routes/public'
import { developerRouter } from '../src/routes/developer'
import { AppError, errorHandler } from '../src/middleware/errorHandler'

const app = express()
app.use(express.json())
app.use('/api/public', publicRouter)
app.use('/api/developer', developerRouter)
app.use(errorHandler)

describe('configuration runtime des routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findUserMock.mockResolvedValue({ id: 'test-user', fullName: 'Développeur de test' })
    findConfigsMock.mockResolvedValue([
      {
        key: 'SMTP_PASS', value: 'stored-secret', category: 'NOTIFICATIONS', label: 'Mot de passe SMTP',
        description: null, isSecret: true, isEditable: true, updatedAt: new Date(), updatedBy: null,
      },
    ])
    verifySmtpMock.mockResolvedValue(undefined)
    auditMock.mockResolvedValue(undefined)
  })

  it('publie uniquement le client ID Google et son statut', async () => {
    getConfigMock.mockReturnValue('client-id.apps.googleusercontent.com')

    const response = await request(app).get('/api/public/client-config')

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({
      success: true,
      data: {
        googleClientId: 'client-id.apps.googleusercontent.com',
        googleEnabled: true,
      },
    })
  })

  it('désactive Google quand le client ID est absent ou vide', async () => {
    getConfigMock.mockReturnValue('  ')

    const response = await request(app).get('/api/public/client-config')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      data: { googleClientId: null, googleEnabled: false },
    })
  })

  it('refuse le test SMTP sans authentification et pour ADMIN', async () => {
    const anonymous = await request(app).post('/api/developer/config/test/smtp').send({})
    const admin = await request(app)
      .post('/api/developer/config/test/smtp')
      .set('x-test-role', 'ADMIN')
      .send({})

    expect(anonymous.status).toBe(401)
    expect(admin.status).toBe(403)
    expect(verifySmtpMock).not.toHaveBeenCalled()
  })

  it('teste SMTP et audite seulement le résultat avec un rôle DEVELOPER', async () => {
    const response = await request(app)
      .post('/api/developer/config/test/smtp')
      .set('x-test-role', 'DEVELOPER')
      .send({})

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      success: true,
      data: { message: 'Connexion SMTP vérifiée avec succès.' },
    })
    expect(verifySmtpMock).toHaveBeenCalledOnce()
    expect(auditMock).toHaveBeenCalledOnce()
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      action: 'DEVELOPER_PANEL_CONFIG_CHANGED',
      entityType: 'SMTP',
      details: { action: 'connection_test', success: true },
    })
    expect(auditMock.mock.calls[0][0].details).toEqual({ action: 'connection_test', success: true })
  })

  it('audite un échec SMTP sans inclure de détails de connexion', async () => {
    verifySmtpMock.mockRejectedValue(new AppError(
      'SMTP_VERIFICATION_FAILED', 'La connexion SMTP a échoué. Vérifiez les paramètres du serveur.', 502,
    ))

    const response = await request(app)
      .post('/api/developer/config/test/smtp')
      .set('x-test-role', 'DEVELOPER')
      .send({})

    expect(response.status).toBe(502)
    expect(response.body.error).toEqual({
      code: 'SMTP_VERIFICATION_FAILED',
      message: 'La connexion SMTP a échoué. Vérifiez les paramètres du serveur.',
    })
    expect(auditMock.mock.calls[0][0].details).toEqual({ action: 'connection_test', success: false })
    expect(auditMock.mock.calls[0][0].details).not.toHaveProperty('error')
  })

  it('refuse un corps inattendu au test SMTP', async () => {
    const response = await request(app)
      .post('/api/developer/config/test/smtp')
      .set('x-test-role', 'DEVELOPER')
      .send({ password: 'secret-test' })

    expect(response.status).toBe(400)
    expect(verifySmtpMock).not.toHaveBeenCalled()
  })

  it('indique si un secret de configuration est renseigné sans le renvoyer', async () => {
    getConfigMock.mockImplementation((key: string) => key === 'SMTP_PASS' ? 'stored-secret' : '')
    findConfigsMock.mockResolvedValue([
      {
        key: 'SMTP_PASS', value: '', category: 'NOTIFICATIONS', label: 'Mot de passe SMTP',
        description: null, isSecret: true, isEditable: true, updatedAt: new Date(), updatedBy: null,
      },
      {
        key: 'VAPID_PRIVATE_KEY', value: '', category: 'NOTIFICATIONS', label: 'Clé privée VAPID',
        description: null, isSecret: true, isEditable: true, updatedAt: new Date(), updatedBy: null,
      },
    ])

    const response = await request(app)
      .get('/api/developer/config')
      .set('x-test-role', 'DEVELOPER')

    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject([
      { key: 'SMTP_PASS', value: '••••••••', isSecret: true, isSet: true },
      { key: 'VAPID_PRIVATE_KEY', value: '••••••••', isSecret: true, isSet: false },
    ])
    expect(JSON.stringify(response.body)).not.toContain('stored-secret')
  })
})
