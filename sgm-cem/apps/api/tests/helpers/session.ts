import { randomUUID } from 'crypto'
import { getPrisma } from '../../src/lib/prisma'
import { signAccessToken } from '../../src/lib/session'

/**
 * Jeton d'accès de test adossé à une vraie session en base (le middleware
 * refuse un jeton dont la session n'existe pas). Le rôle peut être forcé
 * pour tester le RBAC sans créer de compte dédié.
 */
export async function testAccessToken(payload: { userId: string; role: string; email: string; impersonatedBy?: string }): Promise<string> {
  const sid = randomUUID()
  await getPrisma().userSession.create({
    data: {
      id: sid,
      userId: payload.impersonatedBy ?? payload.userId,
      refreshToken: `test-${sid}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  })
  return signAccessToken({ ...payload, sid })
}

export async function testCookie(payload: { userId: string; role: string; email: string; impersonatedBy?: string }): Promise<string> {
  return `access_token=${await testAccessToken(payload)}`
}
