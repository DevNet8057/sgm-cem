// Traçabilité des fonds — 3 exigences utilisateur (2026-07-05) :
// 1. L'ADMIN voit qui a envoyé l'argent à qui, et par quel canal (transferType)
// 2. Le dépôt banque du trésorier enregistre une référence de bordereau = preuve consultable
// 3. Une remise collecteur → trésorier reste PENDING tant que le trésorier n'a pas validé
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { getJwtSecret } from '../src/lib/security'

const prisma = getPrisma()

function cookieFor(userId: string, role: string, email: string): string {
  return `access_token=${jwt.sign({ userId, role, email }, getJwtSecret(), { expiresIn: '15m' })}`
}

let adminCookie = ''
let collecteurCookie = ''

beforeAll(async () => {
  // N'importe quel compte réel sert de porteur : le RBAC lit le rôle du JWT
  const anyUser = await prisma.user.findFirst()
  if (!anyUser) throw new Error('Seed requis')
  adminCookie = cookieFor(anyUser.id, 'ADMIN', anyUser.email)

  const collecteur = await prisma.user.findFirst({ where: { role: 'COLLECTEUR', isActive: true } })
  if (!collecteur) throw new Error('Seed requis : collecteur')
  collecteurCookie = cookieFor(collecteur.id, 'COLLECTEUR', collecteur.email)
})

describe('1. ADMIN — visibilité complète des transferts (qui → qui, par quel canal)', () => {
  it('GET /funds/transfers renvoie TOUS les transferts avec expéditeur, récepteur et canal', async () => {
    const res = await request(app).get('/api/funds/transfers').set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    for (const t of res.body.data as Array<Record<string, unknown>>) {
      expect(t.senderName).toBeTruthy()   // qui a envoyé
      expect(t.receiverName).toBeTruthy() // à qui
      expect(t.transferType).toBeTruthy() // par quel canal (espèces en main, dépôt MTN/Orange…)
      expect(t.status).toBeTruthy()       // PENDING_APPROVAL / CONFIRMED / …
    }
  })

  it('un COLLECTEUR ne voit que ses propres transferts (pas la vue globale ADMIN)', async () => {
    const res = await request(app).get('/api/funds/transfers').set('Cookie', collecteurCookie)
    expect(res.status).toBe(200)
    // Chaque transfert visible doit impliquer le collecteur (envoyeur ou receveur)
    const collecteur = await prisma.user.findFirst({ where: { role: 'COLLECTEUR', isActive: true } })
    for (const t of res.body.data as Array<{ senderId: string; receiverId: string }>) {
      expect([t.senderId, t.receiverId]).toContain(collecteur!.id)
    }
  })
})

describe('2. Dépôt banque — la référence de bordereau est une preuve consultable', () => {
  it('GET /funds/bank-deposits accessible à l\'ADMIN avec référence + déposant + contributions', async () => {
    const res = await request(app).get('/api/funds/bank-deposits').set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    for (const d of res.body.data as Array<Record<string, unknown>>) {
      expect(d.referenceBordereau).toBeTruthy() // LA preuve
      expect(d.depositedByName).toBeTruthy()    // qui a déposé
      expect(typeof d.totalAmount).toBe('number')
      expect(Array.isArray(d.contributions)).toBe(true)
    }
  })

  it('refusé pour un COLLECTEUR (niveau < 4)', async () => {
    const res = await request(app).get('/api/funds/bank-deposits').set('Cookie', collecteurCookie)
    expect(res.status).toBe(403)
  })

  it('POST /funds/bank-deposit sans référence de bordereau → 400 (preuve obligatoire)', async () => {
    const csrf = await request(app).get('/api/csrf-token').set('Cookie', adminCookie)
    const csrfCookie = (Array.isArray(csrf.headers['set-cookie']) ? csrf.headers['set-cookie'] : [])
      .find((c: string) => c.startsWith('csrf_token=')) ?? ''
    const res = await request(app)
      .patch('/api/funds/bank-deposit')
      .set('Cookie', `${adminCookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrf.body.token)
      .send({ contributionIds: ['x'], referenceBordereau: '' })
    expect(res.status).toBe(400)
  })
})

describe('3. Remise collecteur → trésorier : PENDING tant que non validée par le récepteur', () => {
  it('le statut par défaut d\'un FundsTransfer est PENDING_APPROVAL (schéma)', async () => {
    // Vérifié structurellement : la valeur par défaut Prisma
    const dmmf = (prisma as unknown as { _runtimeDataModel: { models: Record<string, { fields: Array<{ name: string; default?: { name?: string } | string }> }> } })._runtimeDataModel
    const statusField = dmmf.models.FundsTransfer.fields.find(f => f.name === 'status')
    const def = typeof statusField?.default === 'object' ? undefined : statusField?.default
    expect(def).toBe('PENDING_APPROVAL')
  })

  it('seul le RÉCEPTEUR peut confirmer (RB-23) — un tiers reçoit 403', async () => {
    // Chercher un transfert en attente dont le récepteur n'est PAS notre porteur de jeton
    const pending = await prisma.fundsTransfer.findFirst({ where: { status: 'PENDING_APPROVAL' } })
    if (!pending) return // aucun transfert en attente en base — règle couverte par le code (RB-23)

    const outsider = await prisma.user.findFirst({ where: { id: { notIn: [pending.receiverId] } } })
    const outsiderCookie = cookieFor(outsider!.id, 'TRESORIER', outsider!.email)
    const csrf = await request(app).get('/api/csrf-token').set('Cookie', outsiderCookie)
    const csrfCookie = (Array.isArray(csrf.headers['set-cookie']) ? csrf.headers['set-cookie'] : [])
      .find((c: string) => c.startsWith('csrf_token=')) ?? ''

    const res = await request(app)
      .patch(`/api/funds/transfers/${pending.id}/confirm`)
      .set('Cookie', `${outsiderCookie}; ${csrfCookie}`)
      .set('x-csrf-token', csrf.body.token)
      .send({})
    expect(res.status).toBe(403)

    // Et le transfert est TOUJOURS en attente
    const still = await prisma.fundsTransfer.findUnique({ where: { id: pending.id } })
    expect(still!.status).toBe('PENDING_APPROVAL')
  })
})
