// Collecte publique (P2) — routes /api/public/*, SANS authentification.
// Le paiement Yelii est MOCKÉ : ces tests ne doivent jamais toucher le réseau.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { Prisma } from '@prisma/client'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { hashDraftToken, type ChampPersonnalise } from '../src/services/collecte.service'
import { getConfigNumber } from '../src/services/config.service'
import { calculateAmountWithCommission, YELII_COMMISSION_RATE } from '@sgm-cem/shared'

// Le module Yelii réel ferait un appel réseau — on ne mocke QUE la fonction
// d'initiation, le reste du module (signature webhook, etc.) reste intact
// pour ne pas perturber d'autres tests qui l'importeraient.
const { initiateYeliiMock } = vi.hoisted(() => ({
  initiateYeliiMock: vi.fn(async () => ({
    success: true,
    transactionId: 'TEST-YELII-TX-PUBLIC-E2E',
    status: 'processing' as const,
  })),
}))

vi.mock('../src/services/yelii.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/yelii.service')>()
  return { ...actual, initiateYeliiPayment: initiateYeliiMock }
})

const prisma = getPrisma()

const RUBRIQUE_CODE = 'TEST-PUB-E2E-ACTIVE'
const RUBRIQUE_CODE_INACTIVE = 'TEST-PUB-E2E-INACTIVE'
const SLUG = 'test-collecte-publique-e2e'
const SLUG_INACTIVE = 'test-collecte-publique-inactive-e2e'
const PHONE_RAW = '677001122'
const PHONE_E164 = '+237677001122'

const CHAMPS: ChampPersonnalise[] = [
  { key: 'lienParente', label: 'Lien de parenté', type: 'select', required: true, options: ['Famille', 'Ami', 'Voisin'] },
  { key: 'nombrePersonnes', label: 'Nombre de personnes', type: 'number', required: false },
]

/** Récupère un couple (cookie, token) CSRF valide — les mutations publiques restent protégées. */
async function getCsrfPair(): Promise<{ cookie: string; token: string }> {
  const res = await request(app).get('/api/csrf-token')
  const setCookie = res.headers['set-cookie']
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean)
  const cookie = cookies.find((c: string) => c.startsWith('csrf_token=')) ?? ''
  return { cookie, token: res.body.token as string }
}

/** Nettoie tout ce que ce fichier peut avoir créé, dans l'ordre des FK (idempotent). */
async function cleanupFixtures(): Promise<void> {
  const collectes = await prisma.collectePublique.findMany({
    where: { publicSlug: { in: [SLUG, SLUG_INACTIVE] } },
  })
  const collecteIds = collectes.map(c => c.id)
  const rubriqueIds = collectes.map(c => c.rubriqueId)

  if (collecteIds.length > 0) {
    await prisma.collecteDraft.deleteMany({ where: { collecteId: { in: collecteIds } } })
  }

  const contributeur = await prisma.contributeurExterne.findFirst({ where: { phone: PHONE_E164 } })
  if (contributeur) {
    await prisma.contribution.deleteMany({ where: { contributeurExterneId: contributeur.id } })
    await prisma.contributeurExterne.delete({ where: { id: contributeur.id } })
  }

  if (collecteIds.length > 0) {
    await prisma.collectePublique.deleteMany({ where: { id: { in: collecteIds } } })
  }
  if (rubriqueIds.length > 0) {
    await prisma.rubrique.deleteMany({ where: { id: { in: rubriqueIds } } })
  }
  // Rubrique orpheline d'un run précédent interrompu avant la création de sa collecte
  await prisma.rubrique.deleteMany({ where: { code: { in: [RUBRIQUE_CODE, RUBRIQUE_CODE_INACTIVE] } } })
}

let csrf: { cookie: string; token: string }
let collecteId = ''
let draftToken = ''
let draftToken2 = ''
let contributeurId = ''
let contributionId = ''

beforeAll(async () => {
  csrf = await getCsrfPair()
  await cleanupFixtures()

  const anyUser = await prisma.user.findFirst()
  if (!anyUser) throw new Error('Seed requis')

  const rubrique = await prisma.rubrique.create({
    data: {
      code: RUBRIQUE_CODE,
      title: 'Rubrique test — collecte publique E2E',
      type: 'PONCTUELLE',
      status: 'OUVERTE',
      fiscalYear: 2026,
      openDate: new Date(),
      createdById: anyUser.id,
      createdByName: anyUser.fullName,
    },
  })

  const rubriqueInactive = await prisma.rubrique.create({
    data: {
      code: RUBRIQUE_CODE_INACTIVE,
      title: 'Rubrique test — collecte publique désactivée',
      type: 'PONCTUELLE',
      status: 'OUVERTE',
      fiscalYear: 2026,
      openDate: new Date(),
      createdById: anyUser.id,
      createdByName: anyUser.fullName,
    },
  })

  const collecte = await prisma.collectePublique.create({
    data: {
      rubriqueId: rubrique.id,
      publicSlug: SLUG,
      titre: 'Collecte de test E2E',
      description: 'Description de test',
      champsPersonnalises: CHAMPS as unknown as Prisma.InputJsonValue,
      montantMin: 1000,
      montantsSuggeres: [1000, 2000, 5000],
      isActive: true,
      createdById: anyUser.id,
      createdByName: anyUser.fullName,
    },
  })
  collecteId = collecte.id

  await prisma.collectePublique.create({
    data: {
      rubriqueId: rubriqueInactive.id,
      publicSlug: SLUG_INACTIVE,
      titre: 'Collecte désactivée',
      champsPersonnalises: [] as unknown as Prisma.InputJsonValue,
      isActive: false,
      createdById: anyUser.id,
      createdByName: anyUser.fullName,
    },
  })
})

afterAll(async () => {
  await cleanupFixtures()
})

describe('1. GET /collectes/:slug — vitrine publique, aucune donnée privée', () => {
  it('slug actif → 200 avec la définition publique et RIEN d\'autre (pas de totaux)', async () => {
    const res = await request(app).get(`/api/public/collectes/${SLUG}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.publicSlug).toBe(SLUG)
    expect(res.body.data.titre).toBe('Collecte de test E2E')
    expect(res.body.data.montantMin).toBe(1000)
    expect(res.body.data.montantsSuggeres).toEqual([1000, 2000, 5000])
    expect(res.body.data.champsPersonnalises).toHaveLength(2)
    expect(Object.keys(res.body.data).sort()).toEqual(
      ['champsPersonnalises', 'description', 'montantMin', 'montantsSuggeres', 'publicSlug', 'titre'].sort()
    )
  })

  it('collecte isActive:false → 404', async () => {
    const res = await request(app).get(`/api/public/collectes/${SLUG_INACTIVE}`)
    expect(res.status).toBe(404)
  })

  it('slug inconnu → 404', async () => {
    const res = await request(app).get('/api/public/collectes/slug-qui-nexiste-pas')
    expect(res.status).toBe(404)
  })
})

describe('2. Brouillons — création, reprise, anti-énumération', () => {
  it('POST drafts → 201 avec draftToken (64 hex) et expiresAt', async () => {
    const res = await request(app)
      .post(`/api/public/collectes/${SLUG}/drafts`)
      .set('Cookie', csrf.cookie)
      .set('x-csrf-token', csrf.token)
      .send({ nom: 'Jean Testeur', phone: PHONE_RAW, montant: 2000, valeursChamps: { lienParente: 'Famille' } })
    expect(res.status).toBe(201)
    expect(res.body.data.draftToken).toMatch(/^[0-9a-f]{64}$/)
    expect(res.body.data.expiresAt).toBeTruthy()
    draftToken = res.body.data.draftToken
  })

  it('GET drafts avec ce token → 200 et les valeurs saisies', async () => {
    const res = await request(app).get('/api/public/drafts').set('X-Draft-Token', draftToken)
    expect(res.status).toBe(200)
    expect(res.body.data.nom).toBe('Jean Testeur')
    expect(res.body.data.phone).toBe(PHONE_E164)
    expect(res.body.data.montant).toBe(2000)
    expect(res.body.data.valeursChamps).toEqual({ lienParente: 'Famille' })
    expect(res.body.data.statut).toBe('ACTIF')
    expect(res.body.data.collecte.publicSlug).toBe(SLUG)
  })

  it('GET drafts avec un token bidon → 404 « Brouillon introuvable ou expiré »', async () => {
    const res = await request(app)
      .get('/api/public/drafts')
      .set('X-Draft-Token', 'a'.repeat(64))
    expect(res.status).toBe(404)
    expect(res.body.error.message).toBe('Brouillon introuvable ou expiré')
  })

  it('GET drafts avec le token d\'un draft expiré → même 404, MÊME corps que le token bidon', async () => {
    const bidonRes = await request(app).get('/api/public/drafts').set('X-Draft-Token', 'b'.repeat(64))

    const rawToken = 'c'.repeat(64)
    await prisma.collecteDraft.create({
      data: {
        collecteId,
        tokenHash: hashDraftToken(rawToken),
        expiresAt: new Date(Date.now() - 60_000), // déjà expiré
      },
    })

    const expiredRes = await request(app).get('/api/public/drafts').set('X-Draft-Token', rawToken)
    expect(expiredRes.status).toBe(404)
    expect(expiredRes.body).toEqual(bidonRes.body)
  })
})

describe('3. PATCH drafts — mise à jour et prolongation de l\'expiration', () => {
  it('met à jour les valeurs et prolonge expiresAt, sans renvoyer draftToken', async () => {
    const before = await prisma.collecteDraft.findUnique({ where: { tokenHash: hashDraftToken(draftToken) } })

    const res = await request(app)
      .patch('/api/public/drafts')
      .set('X-Draft-Token', draftToken)
      .set('Cookie', csrf.cookie)
      .set('x-csrf-token', csrf.token)
      .send({ nom: 'Jean Testeur', phone: PHONE_RAW, montant: 3000, valeursChamps: { lienParente: 'Famille', nombrePersonnes: 4 } })

    expect(res.status).toBe(200)
    expect(res.body.data.montant).toBe(3000)
    expect(res.body.data.valeursChamps).toEqual({ lienParente: 'Famille', nombrePersonnes: 4 })
    expect(res.body.data.draftToken).toBeUndefined()

    const after = await prisma.collecteDraft.findUnique({ where: { tokenHash: hashDraftToken(draftToken) } })
    expect(after!.expiresAt.getTime()).toBeGreaterThan(before!.expiresAt.getTime())
  })
})

describe('4. POST initiate — conversion en Contribution + paiement Yelii (mocké)', () => {
  it('champ select requis manquant → 400 VALIDATION_ERROR (ZodError)', async () => {
    const res = await request(app)
      .post(`/api/public/collectes/${SLUG}/initiate`)
      .set('X-Draft-Token', draftToken)
      .set('Cookie', csrf.cookie)
      .set('x-csrf-token', csrf.token)
      .send({
        nom: 'Jean Testeur', phone: PHONE_RAW, montant: 2000,
        valeursChamps: { nombrePersonnes: 3 }, // lienParente manquant
        modePaiement: 'YELII', channel: 'mtn_money',
      })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('montant < montantMin → 400', async () => {
    const res = await request(app)
      .post(`/api/public/collectes/${SLUG}/initiate`)
      .set('X-Draft-Token', draftToken)
      .set('Cookie', csrf.cookie)
      .set('x-csrf-token', csrf.token)
      .send({
        nom: 'Jean Testeur', phone: PHONE_RAW, montant: 500, // < montantMin (1000)
        valeursChamps: { lienParente: 'Ami' },
        modePaiement: 'YELII', channel: 'mtn_money',
      })
    expect(res.status).toBe(400)
  })

  it('initiate valide → Contribution créée, montant majoré transmis à Yelii, draft CONVERTI', async () => {
    const expectedRate = getConfigNumber('YELII_COMMISSION_RATE', YELII_COMMISSION_RATE)
    const { totalToPay, commissionAmount } = calculateAmountWithCommission(2000, expectedRate)

    const res = await request(app)
      .post(`/api/public/collectes/${SLUG}/initiate`)
      .set('X-Draft-Token', draftToken)
      .set('Cookie', csrf.cookie)
      .set('x-csrf-token', csrf.token)
      .send({
        nom: 'Jean Testeur', phone: PHONE_RAW, montant: 2000,
        valeursChamps: { lienParente: 'Ami', nombrePersonnes: 2 },
        modePaiement: 'YELII', channel: 'mtn_money',
      })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.status).toBe('PROCESSING')
    expect(res.body.data.totalToPay).toBe(totalToPay)
    expect(res.body.data.commissionAmount).toBe(commissionAmount)
    contributionId = res.body.data.contributionId

    // Le montant MAJORÉ (pas le montant dû brut) est transmis à Yelii
    expect(initiateYeliiMock).toHaveBeenCalledWith({
      amount: totalToPay,
      senderPhone: PHONE_E164,
      channel: 'mtn_money',
    })

    const contribution = await prisma.contribution.findUnique({ where: { id: contributionId } })
    expect(contribution).toBeTruthy()
    expect(contribution!.membreId).toBeNull()
    expect(contribution!.contributeurExterneId).not.toBeNull()
    expect(contribution!.valeursChamps).toEqual({ lienParente: 'Ami', nombrePersonnes: 2 })
    contributeurId = contribution!.contributeurExterneId!

    const draft = await prisma.collecteDraft.findUnique({ where: { tokenHash: hashDraftToken(draftToken) } })
    expect(draft!.statut).toBe('CONVERTI')
    expect(draft!.contributionId).toBe(contributionId)
  })
})

describe('5. Idempotence — anti double-clic', () => {
  it('un second initiate avec le même token renvoie alreadyInitiated sans créer de nouvelle contribution', async () => {
    const countBefore = await prisma.contribution.count({ where: { contributeurExterneId: contributeurId } })
    const callsBefore = initiateYeliiMock.mock.calls.length

    const res = await request(app)
      .post(`/api/public/collectes/${SLUG}/initiate`)
      .set('X-Draft-Token', draftToken)
      .set('Cookie', csrf.cookie)
      .set('x-csrf-token', csrf.token)
      .send({
        nom: 'Jean Testeur', phone: PHONE_RAW, montant: 2000,
        valeursChamps: { lienParente: 'Ami', nombrePersonnes: 2 },
        modePaiement: 'YELII', channel: 'mtn_money',
      })

    expect(res.status).toBe(200)
    expect(res.body.data.alreadyInitiated).toBe(true)
    expect(res.body.data.contributionId).toBe(contributionId)

    const countAfter = await prisma.contribution.count({ where: { contributeurExterneId: contributeurId } })
    expect(countAfter).toBe(countBefore)
    expect(initiateYeliiMock.mock.calls.length).toBe(callsBefore) // Yelii pas ré-appelé
  })
})

describe('6. GET /payments/:id/status — polling lié au brouillon', () => {
  it('avec le bon token → 200', async () => {
    const res = await request(app)
      .get(`/api/public/payments/${contributionId}/status`)
      .set('X-Draft-Token', draftToken)
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(contributionId)
    expect(res.body.data.paymentStatus).toBe('PROCESSING')
  })

  it('avec le token d\'un AUTRE brouillon → 404 générique', async () => {
    const otherDraftRes = await request(app)
      .post(`/api/public/collectes/${SLUG}/drafts`)
      .set('Cookie', csrf.cookie)
      .set('x-csrf-token', csrf.token)
      .send({ nom: 'Autre Personne', phone: '677998877' })
    draftToken2 = otherDraftRes.body.data.draftToken

    const res = await request(app)
      .get(`/api/public/payments/${contributionId}/status`)
      .set('X-Draft-Token', draftToken2)
    expect(res.status).toBe(404)
    expect(res.body.error.message).toBe('Brouillon introuvable ou expiré')
  })
})

describe('7. CSRF — les routes publiques restent protégées', () => {
  it('POST drafts SANS header x-csrf-token → 403 CSRF_INVALID', async () => {
    const res = await request(app)
      .post(`/api/public/collectes/${SLUG}/drafts`)
      .set('Cookie', csrf.cookie) // cookie csrf posé, header volontairement omis
      .send({ nom: 'Sans CSRF' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CSRF_INVALID')
  })
})

describe('8. RBAC régression — /api/collectes reste une route admin', () => {
  it('GET /api/collectes sans cookie → 401', async () => {
    const res = await request(app).get('/api/collectes')
    expect(res.status).toBe(401)
  })
})
