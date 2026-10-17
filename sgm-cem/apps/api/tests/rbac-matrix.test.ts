// Matrice RBAC (doc 06) : 1) garde d'authentification sur TOUTES les routes
// montées, découvertes automatiquement — une route ajoutée sans `authenticate`
// fait échouer ce test ; 2) droits par rôle des opérations sensibles.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app, { ROUTE_MOUNTS } from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { testCookie } from './helpers/session'

const prisma = getPrisma()

// Routes volontairement accessibles sans session
const PUBLIC_ROUTES = [
  /^\w+ \/webhooks\//,
  /^GET \/api\/csrf-token$/,
  /^GET \/api\/health(\/ready)?$/, // sondes de supervision
  /^GET \/api\/status$/, // état du mode maintenance (bandeau), sans donnée
  /^\w+ \/api\/public\//,
  /^POST \/api\/auth\/(login|forgot-password|otp\/request|otp\/verify|google|refresh)$/,
]

type Layer = { route?: { path: string | string[]; methods: Record<string, boolean> } }

function listRoutes(stack: Layer[], prefix = ''): string[] {
  const out: string[] = []
  for (const layer of stack) {
    if (!layer.route) continue
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]
    for (const method of Object.keys(layer.route.methods)) {
      for (const path of paths) out.push(`${method.toUpperCase()} ${prefix}${path}`)
    }
  }
  return out
}

async function anonymousCsrf() {
  const res = await request(app).get('/api/csrf-token')
  const cookie = (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]
  return { cookie, token: res.body.token as string }
}

// Routes de l'application (santé, CSRF…) + celles de chaque routeur monté (index.ts)
const routes = [
  ...listRoutes((app as unknown as { router: { stack: Layer[] } }).router.stack),
  ...ROUTE_MOUNTS.flatMap(([prefix, router]) => listRoutes((router as unknown as { stack: Layer[] }).stack, prefix)),
]
  .map(r => r.replace(/\/$/, '') || r)
  .filter((r, i, all) => all.indexOf(r) === i)
const protectedRoutes = routes.filter(r => !PUBLIC_ROUTES.some(p => p.test(r)))

describe('Garde d\'authentification universelle', () => {
  it('les routes sont bien découvertes', () => {
    expect(routes.length).toBeGreaterThan(100)
    expect(protectedRoutes.length).toBeGreaterThan(80)
  })

  it.each(protectedRoutes)('%s → 401 sans session', async route => {
    const [method, rawPath] = route.split(' ')
    const path = rawPath.replace(/:[A-Za-z]+/g, 'id-inexistant')
    const csrf = await anonymousCsrf()
    const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method.toLowerCase()](path)
      .set('Cookie', csrf.cookie)
      .set('x-csrf-token', csrf.token)
      .send({})
    expect(res.status).toBe(401)
  })
})

// Lecture : rôle minimal autorisé et rôle juste en dessous refusé (403)
const READ_MATRIX: Array<{ path: string; allowed: string; denied: string }> = [
  { path: '/api/users', allowed: 'ADMIN', denied: 'TRESORIER' },
  { path: '/api/developer/config', allowed: 'DEVELOPER', denied: 'ADMIN' },
  { path: '/api/settings', allowed: 'TRESORIER', denied: 'RESPONSABLE' },
  { path: '/api/funds/bank-deposits', allowed: 'TRESORIER', denied: 'RESPONSABLE' },
  { path: '/api/collectes', allowed: 'TRESORIER', denied: 'RESPONSABLE' },
  { path: '/api/stats/dashboard', allowed: 'RESPONSABLE', denied: 'COLLECTEUR' },
  { path: '/api/contributions/litiges', allowed: 'RESPONSABLE', denied: 'COLLECTEUR' },
  { path: '/api/contributions', allowed: 'COLLECTEUR', denied: 'MEMBRE' },
  { path: '/api/membres', allowed: 'COLLECTEUR', denied: 'MEMBRE' },
  { path: '/api/commissions/documents', allowed: 'COLLECTEUR', denied: 'MEMBRE' },
  { path: '/api/contributions/me', allowed: 'MEMBRE', denied: '' },
  { path: '/api/contributions/todo', allowed: 'COLLECTEUR', denied: 'MEMBRE' },
]

// Écritures refusées (aucun effet si le refus fonctionne)
const WRITE_DENIALS: Array<{ method: 'post' | 'patch' | 'put'; path: string; role: string }> = [
  { method: 'post', path: '/api/users', role: 'TRESORIER' },
  { method: 'patch', path: '/api/users/id-inexistant/toggle-active', role: 'TRESORIER' },
  { method: 'put', path: '/api/developer/config/LOG_LEVEL', role: 'ADMIN' },
  { method: 'patch', path: '/api/funds/bank-deposit', role: 'COLLECTEUR' },
  { method: 'patch', path: '/api/contributions/id-inexistant/litige', role: 'COLLECTEUR' },
  { method: 'patch', path: '/api/contributions/id-inexistant/resolve-litige', role: 'COLLECTEUR' },
  { method: 'post', path: '/api/contributions', role: 'MEMBRE' },
  { method: 'post', path: '/api/membres', role: 'COLLECTEUR' },
]

let user: { id: string; email: string }

beforeAll(async () => {
  const run = `rbac-${Date.now()}`
  user = await prisma.user.create({
    data: { memberId: run, firstName: 'Rbac', lastName: 'Test', fullName: 'Rbac Test', email: `${run}@test.local`, passwordHash: 'disabled', role: 'MEMBRE', mustChangePassword: false },
    select: { id: true, email: true },
  })
})

async function asRole(role: string) {
  const cookie = await testCookie({ userId: user.id, role, email: user.email })
  const res = await request(app).get('/api/csrf-token').set('Cookie', cookie)
  const csrfCookie = (res.headers['set-cookie'] as unknown as string[]).find(c => c.startsWith('csrf_token='))!.split(';')[0]
  return { cookie: `${cookie}; ${csrfCookie}`, token: res.body.token as string }
}

describe('Matrice des droits — lecture', () => {
  it.each(READ_MATRIX)('$path : $allowed autorisé, $denied refusé', async ({ path, allowed, denied }) => {
    const ok = await request(app).get(path).set('Cookie', (await asRole(allowed)).cookie)
    expect([401, 403]).not.toContain(ok.status)
    if (denied) {
      const ko = await request(app).get(path).set('Cookie', (await asRole(denied)).cookie)
      expect(ko.status).toBe(403)
    }
  })
})

describe('Matrice des droits — écritures refusées', () => {
  it.each(WRITE_DENIALS)('$method $path refusé à $role', async ({ method, path, role }) => {
    const s = await asRole(role)
    const res = await request(app)[method](path).set('Cookie', s.cookie).set('x-csrf-token', s.token).send({})
    expect(res.status).toBe(403)
  })
})
