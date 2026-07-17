// ──────────────────────────────────────────────────────────────────────
// ROUTES PUBLIQUES — page de don d'une collecte publique, brouillons et
// paiement, accessibles SANS authentification (lien partagé au public).
//
// Le CSRF global (double-submit cookie, voir index.ts) reste actif ici —
// seuls /webhooks et /auth/google en sont exemptés.
//
// Vie privée : ces routes ne renvoient JAMAIS de total collecté, de liste
// de contributions, ni le nom d'un autre contributeur. Les erreurs
// « brouillon introuvable » restent volontairement génériques — on ne
// distingue jamais token inconnu / expiré / déjà converti (anti-énumération).
// ──────────────────────────────────────────────────────────────────────
import { Router } from 'express'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import { Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler'
import { getPrisma } from '../lib/prisma'
import { audit } from '../services/audit.service'
import { getConfigBool, getConfigNumber } from '../services/config.service'
import { initiateYeliiPayment } from '../services/yelii.service'
import { initiateCinetpayPayment } from '../services/cinetpay.service'
import {
  buildDynamicSchema,
  generateDraftToken,
  hashDraftToken,
  normalizePhone,
  type ChampPersonnalise,
} from '../services/collecte.service'
import { calculateAmountWithCommission, YELII_COMMISSION_RATE } from '@sgm-cem/shared'

const router = Router()
const prisma = getPrisma()

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

// 30 req / 15 min : suffisant pour un formulaire de don, freine le scraping.
const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 })
// Le polling de statut est plus fréquent côté client — fenêtre élargie.
const statusLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120 })

/** 404 générique, identique quel que soit le motif réel (anti-énumération). */
function draftNotFoundError(): AppError {
  return new AppError('NOT_FOUND', 'Brouillon introuvable ou expiré', 404)
}

// AuditLog.userId a une FK vers User : un userId libre ('public') ferait
// échouer silencieusement l'écriture d'audit (best-effort). On rattache donc
// les actions publiques à un compte SYSTÈME dédié, désactivé (non connectable),
// créé à la première utilisation — le nom réel du contributeur reste dans
// userName et details.
let publicAuditUserId: string | null = null
async function getPublicAuditUserId(): Promise<string> {
  if (publicAuditUserId) return publicAuditUserId
  const user = await prisma.user.upsert({
    where: { email: 'systeme.public@sgm-cem.local' },
    update: {},
    create: {
      memberId: 'SYS-PUBLIC',
      firstName: 'Contributions',
      lastName: 'Publiques',
      fullName: 'Contributions publiques',
      email: 'systeme.public@sgm-cem.local',
      passwordHash: 'disabled', // jamais un hash bcrypt valide — connexion impossible
      role: 'MEMBRE',
      isActive: false,
      mustChangePassword: false,
    },
  })
  publicAuditUserId = user.id
  return user.id
}

/** Charge une collecte publique par son slug ; 404 si absente, désactivée ou rubrique fermée. */
async function findValidCollecte(slug: string) {
  const collecte = await prisma.collectePublique.findUnique({
    where: { publicSlug: slug },
    include: { rubrique: { select: { status: true } } },
  })
  if (!collecte || !collecte.isActive || collecte.rubrique.status !== 'OUVERTE') {
    throw new AppError('NOT_FOUND', 'Collecte introuvable ou fermée', 404)
  }
  return collecte
}

/** Extrait le header X-Draft-Token et retourne le brouillon correspondant. */
async function findDraftByHeader(tokenHeader: unknown) {
  const token = typeof tokenHeader === 'string' ? tokenHeader : undefined
  if (!token) throw draftNotFoundError()
  const draft = await prisma.collecteDraft.findUnique({
    where: { tokenHash: hashDraftToken(token) },
    include: { collecte: { select: { publicSlug: true, titre: true } } },
  })
  if (!draft || draft.expiresAt < new Date()) throw draftNotFoundError()
  return draft
}

/**
 * Brouillon exploitable en lecture/édition (routes 3 et 4) : rejette en plus
 * les brouillons déjà convertis en contribution PAYÉE — au-delà, le don est
 * définitif et le formulaire ne doit plus être rouvert.
 */
async function findEditableDraft(tokenHeader: unknown) {
  const draft = await findDraftByHeader(tokenHeader)
  if (draft.statut === 'CONVERTI' && draft.contributionId) {
    const contribution = await prisma.contribution.findUnique({
      where: { id: draft.contributionId },
      select: { statut: true, paymentStatus: true },
    })
    const isPaid = contribution?.statut === 'CONFIRME' || contribution?.paymentStatus === 'SUCCESS'
    if (isPaid) throw draftNotFoundError()
  }
  return draft
}

const draftBodySchema = z.object({
  nom: z.string().max(120).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  montant: z.number().int().positive().optional(),
  valeursChamps: z.unknown().optional(),
})

/**
 * GET /api/public/collectes/:slug
 * Vitrine publique d'une collecte — aucune donnée privée (pas de total, pas de noms).
 */
router.get('/collectes/:slug', publicLimiter, async (req, res) => {
  const collecte = await findValidCollecte(String(req.params.slug))
  res.json({
    success: true,
    data: {
      publicSlug: collecte.publicSlug,
      titre: collecte.titre,
      description: collecte.description,
      champsPersonnalises: collecte.champsPersonnalises,
      montantMin: collecte.montantMin,
      montantsSuggeres: collecte.montantsSuggeres,
    },
  })
})

/**
 * POST /api/public/collectes/:slug/drafts
 * Crée un brouillon partiel — le token en clair n'est renvoyé qu'ICI, la base
 * ne stocke que son sha256 (voir services/collecte.service.ts).
 */
router.post('/collectes/:slug/drafts', publicLimiter, async (req, res) => {
  const data = draftBodySchema.parse(req.body)
  const collecte = await findValidCollecte(String(req.params.slug))

  const token = generateDraftToken()
  const expiresAt = new Date(Date.now() + DRAFT_TTL_MS)

  await prisma.collecteDraft.create({
    data: {
      collecteId: collecte.id,
      tokenHash: hashDraftToken(token),
      nom: data.nom,
      phone: data.phone ? normalizePhone(data.phone) : undefined,
      email: data.email,
      montant: data.montant,
      valeursChamps: data.valeursChamps as Prisma.InputJsonValue | undefined,
      expiresAt,
    },
  })

  res.status(201).json({ success: true, data: { draftToken: token, expiresAt } })
})

/**
 * GET /api/public/drafts
 * Reprise d'un brouillon par son token (header X-Draft-Token).
 */
router.get('/drafts', publicLimiter, async (req, res) => {
  const draft = await findEditableDraft(req.headers['x-draft-token'])
  res.json({
    success: true,
    data: {
      nom: draft.nom,
      phone: draft.phone,
      email: draft.email,
      montant: draft.montant,
      valeursChamps: draft.valeursChamps,
      statut: draft.statut,
      collecte: draft.collecte,
    },
  })
})

/**
 * PATCH /api/public/drafts
 * Met à jour un brouillon existant et prolonge son expiration de 7 jours.
 */
router.patch('/drafts', publicLimiter, async (req, res) => {
  const data = draftBodySchema.parse(req.body)
  const draft = await findEditableDraft(req.headers['x-draft-token'])

  const updated = await prisma.collecteDraft.update({
    where: { id: draft.id },
    data: {
      nom: data.nom,
      phone: data.phone ? normalizePhone(data.phone) : undefined,
      email: data.email,
      montant: data.montant,
      valeursChamps: data.valeursChamps as Prisma.InputJsonValue | undefined,
      expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
    },
  })

  res.json({
    success: true,
    data: {
      nom: updated.nom,
      phone: updated.phone,
      email: updated.email,
      montant: updated.montant,
      valeursChamps: updated.valeursChamps,
      statut: updated.statut,
      expiresAt: updated.expiresAt,
    },
  })
})

const initiatePublicSchema = z.object({
  nom: z.string().min(2),
  phone: z.string().min(8),
  email: z.string().email().optional(),
  montant: z.number().int().positive(),
  valeursChamps: z.unknown(),
  modePaiement: z.enum(['YELII', 'CARTE_VISA']),
  channel: z.enum(['orange_money', 'mtn_money']).optional(),
}).superRefine((data, ctx) => {
  if (data.modePaiement === 'YELII' && !data.channel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Le réseau mobile money (channel) est requis pour un paiement Yelii',
      path: ['channel'],
    })
  }
})

/** Marque le brouillon comme converti — posé une seule fois, sert d'anti double-clic. */
async function markDraftConverted(draftId: string, contributionId: string): Promise<void> {
  await prisma.collecteDraft.update({
    where: { id: draftId },
    data: { contributionId, statut: 'CONVERTI' },
  })
}

/**
 * POST /api/public/collectes/:slug/initiate
 * Convertit un brouillon en Contribution et initie le paiement. Le draft
 * (header X-Draft-Token) EST l'anti double-clic : un contributionId déjà
 * posé renvoie une réponse idempotente sans ré-initier de paiement.
 */
router.post('/collectes/:slug/initiate', publicLimiter, async (req, res) => {
  const data = initiatePublicSchema.parse(req.body)
  const collecte = await findValidCollecte(String(req.params.slug))
  const draft = await findDraftByHeader(req.headers['x-draft-token'])

  if (draft.contributionId) {
    return res.json({
      success: true,
      data: { contributionId: draft.contributionId, alreadyInitiated: true },
    })
  }

  if (collecte.montantMin && data.montant < collecte.montantMin) {
    throw new AppError('BUSINESS_RULE', `Le montant minimum pour cette collecte est de ${collecte.montantMin} FCFA`)
  }

  // Validation des champs personnalisés — schéma construit à la volée à partir
  // de la définition en base (jamais figé au chargement).
  const champs = collecte.champsPersonnalises as unknown as ChampPersonnalise[]
  const valeursChamps = buildDynamicSchema(champs).parse(data.valeursChamps)

  const phone = normalizePhone(data.phone)

  const existing = await prisma.contributeurExterne.findFirst({ where: { phone } })
  const contributeur = existing
    ? await prisma.contributeurExterne.update({
        where: { id: existing.id },
        data: { nom: data.nom, email: data.email ?? existing.email },
      })
    : await prisma.contributeurExterne.create({
        data: { nom: data.nom, phone, email: data.email },
      })

  const storedMode: 'MTN_MOMO' | 'ORANGE_MONEY' | 'CARTE_VISA' = data.modePaiement === 'YELII'
    ? (data.channel === 'orange_money' ? 'ORANGE_MONEY' : 'MTN_MOMO')
    : 'CARTE_VISA'

  const contribution = await prisma.contribution.create({
    data: {
      membreId: null,
      contributeurExterneId: contributeur.id,
      rubriqueId: collecte.rubriqueId,
      montant: data.montant,
      valeursChamps: valeursChamps as Prisma.InputJsonValue,
      modePaiement: storedMode,
      statut: 'EN_ATTENTE_CONFIRMATION',
      paymentStatus: 'PENDING',
      localisationFonds: 'EN_TRANSIT',
      mobileMoneyPhone: data.modePaiement === 'YELII' ? phone : null,
    },
  })

  await audit({
    req, userId: await getPublicAuditUserId(), userName: `Public: ${data.nom}`,
    action: 'CREATE', entityType: 'Contribution', entityId: contribution.id,
    details: { source: 'collecte_publique', publicSlug: collecte.publicSlug, montant: data.montant, modePaiement: storedMode },
  })

  // ── MODE MOBILE MONEY (Yelii) — même flux que payments.ts ────────────────
  if (data.modePaiement === 'YELII') {
    if (!getConfigBool('MOBILE_MONEY_ENABLED', true)) {
      await prisma.contribution.update({ where: { id: contribution.id }, data: { paymentStatus: 'FAILED' } })
      return res.status(403).json({ success: false, error: 'Le paiement Mobile Money est temporairement désactivé' })
    }

    // §1bis — le contributeur supporte la commission Yelii ; on envoie le
    // montant MAJORÉ à Yelii, jamais le montant dû brut (formule dans @sgm-cem/shared).
    const { totalToPay, commissionAmount } = calculateAmountWithCommission(
      contribution.montant,
      getConfigNumber('YELII_COMMISSION_RATE', YELII_COMMISSION_RATE)
    )

    const payment = await initiateYeliiPayment({
      amount: totalToPay,
      senderPhone: phone,
      channel: data.channel === 'orange_money' ? 'orange_money' : 'mtn_money',
    })

    if (payment.success && payment.transactionId) {
      await prisma.contribution.update({
        where: { id: contribution.id },
        data: {
          externalTransactionId: payment.transactionId,
          paymentStatus: 'PROCESSING',
          amountChargedToPayer: totalToPay,
          commissionPaidByPayer: commissionAmount,
        },
      })
      await markDraftConverted(draft.id, contribution.id)
      return res.json({
        success: true,
        data: {
          contributionId: contribution.id,
          transactionId: payment.transactionId,
          status: 'PROCESSING',
          dueAmount: contribution.montant,
          commissionAmount,
          totalToPay,
        },
      })
    } else {
      await prisma.contribution.update({ where: { id: contribution.id }, data: { paymentStatus: 'FAILED' } })
      return res.json({ success: false, error: payment.message ?? 'Échec du paiement Mobile Money' })
    }
  }

  // ── MODE CARTE BANCAIRE (CinetPay) — même flux que payments.ts ───────────
  const txId = `SGM-${new Date().getFullYear()}-${contribution.id.substring(0, 8).toUpperCase()}`

  try {
    const result = await initiateCinetpayPayment({
      transactionId: txId,
      amount: data.montant,
      description: `Contribution — ${collecte.titre}`.trim(),
      customerName: data.nom,
      customerSurname: 'Public',
    })

    await prisma.contribution.update({
      where: { id: contribution.id },
      data: { externalTransactionId: txId, paymentStatus: 'PROCESSING', paymentUrl: result.paymentUrl },
    })
    await markDraftConverted(draft.id, contribution.id)

    return res.json({
      success: true,
      data: { contributionId: contribution.id, paymentUrl: result.paymentUrl, status: 'PROCESSING' },
    })
  } catch (err) {
    await prisma.contribution.update({ where: { id: contribution.id }, data: { paymentStatus: 'FAILED' } })
    const message = err instanceof Error ? err.message : 'Erreur CinetPay'
    return res.status(500).json({ success: false, error: message })
  }
})

/**
 * GET /api/public/payments/:contributionId/status
 * Polling du statut — le header X-Draft-Token doit correspondre au brouillon
 * qui a converti cette contribution (sinon 404 générique, anti-énumération).
 */
router.get('/payments/:contributionId/status', statusLimiter, async (req, res) => {
  const contributionId = String(req.params.contributionId)
  const draft = await findDraftByHeader(req.headers['x-draft-token'])

  if (draft.contributionId !== contributionId) {
    throw draftNotFoundError()
  }

  const contribution = await prisma.contribution.findUnique({
    where: { id: contributionId },
    select: { id: true, statut: true, paymentStatus: true, receiptUrl: true },
  })

  if (!contribution) throw draftNotFoundError()

  res.json({
    success: true,
    data: {
      id: contribution.id,
      statut: contribution.statut,
      paymentStatus: contribution.paymentStatus,
      receiptUrl: contribution.receiptUrl ?? null,
    },
  })
})

export { router as publicRouter }
