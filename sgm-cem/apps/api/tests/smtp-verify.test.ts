import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  getConfig: vi.fn(),
  getConfigBool: vi.fn(),
}))

vi.mock('nodemailer', () => ({
  default: { createTransport: mocks.createTransport },
}))

vi.mock('../src/services/config.service', () => ({
  getConfig: mocks.getConfig,
  getConfigBool: mocks.getConfigBool,
}))

import { verifySmtpConnection } from '../src/services/email'
import { AppError } from '../src/middleware/errorHandler'

const smtpConfig: Record<string, string> = {
  SMTP_HOST: 'mail.example.test',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'mailer@example.test',
  SMTP_PASS: 'mot-de-passe-test',
}

const transporter = {
  verify: vi.fn(),
  sendMail: vi.fn(),
  close: vi.fn(),
}

describe('verifySmtpConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getConfig.mockImplementation((key: string) => smtpConfig[key])
    mocks.getConfigBool.mockReturnValue(false)
    transporter.verify.mockResolvedValue(true)
    mocks.createTransport.mockReturnValue(transporter)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('vérifie le serveur sans envoyer de message, même si les emails sont désactivés', async () => {
    await expect(verifySmtpConnection()).resolves.toBeUndefined()

    expect(mocks.getConfigBool).not.toHaveBeenCalled()
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: smtpConfig.SMTP_HOST,
      port: 465,
      secure: true,
      auth: { user: smtpConfig.SMTP_USER, pass: smtpConfig.SMTP_PASS },
    }))
    expect(transporter.verify).toHaveBeenCalledOnce()
    expect(transporter.sendMail).not.toHaveBeenCalled()
    expect(transporter.close).toHaveBeenCalledOnce()
  })

  it('refuse une configuration SMTP incomplète sans créer de transport', async () => {
    mocks.getConfig.mockImplementation((key: string) => key === 'SMTP_HOST' ? undefined : smtpConfig[key])

    await expect(verifySmtpConnection()).rejects.toMatchObject({
      code: 'SMTP_NOT_CONFIGURED',
      statusCode: 400,
    })
    expect(mocks.createTransport).not.toHaveBeenCalled()
  })

  it('remplace les détails sensibles d’une erreur du serveur SMTP', async () => {
    transporter.verify.mockRejectedValue(new Error('auth rejected for mailer@example.test with mot-de-passe-test'))

    let error: unknown
    try {
      await verifySmtpConnection()
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({
      code: 'SMTP_VERIFICATION_FAILED',
      message: 'La connexion SMTP a échoué. Vérifiez les paramètres du serveur.',
      statusCode: 502,
    })
    expect(String(error)).not.toContain(smtpConfig.SMTP_PASS)
    expect(transporter.sendMail).not.toHaveBeenCalled()
    expect(transporter.close).toHaveBeenCalledOnce()
  })

  it('interrompt une vérification qui dépasse le délai maximal', async () => {
    vi.useFakeTimers()
    transporter.verify.mockReturnValue(new Promise<boolean>(() => {}))

    const result = expect(verifySmtpConnection()).rejects.toMatchObject({
      code: 'SMTP_VERIFICATION_FAILED',
      statusCode: 502,
    })
    await vi.advanceTimersByTimeAsync(10_000)
    await result

    expect(transporter.close).toHaveBeenCalledOnce()
    expect(transporter.sendMail).not.toHaveBeenCalled()
  })
})
