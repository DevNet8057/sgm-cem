// Exports Excel côté serveur (lot 4.6 — EF-M10-04) : toutes les lignes du
// périmètre autorisé, mêmes filtres que les listes, chaque export journalisé
// (il contient des données personnelles).
import { Router, type Request, type Response } from 'express'
import type { ChampPersonnalise } from '@sgm-cem/shared'
import { authenticate } from '../middleware/auth'
import { requireLevel } from '../middleware/rbac'
import { AppError } from '../middleware/errorHandler'
import { getPrisma } from '../lib/prisma'
import { refundsByRubrique } from '../services/refund.service'
import { audit } from '../services/audit.service'
import { buildXlsx, dateFr, LABELS, XLSX_MIME, type XlsxColumn, type XlsxRow } from '../services/xlsx-export.service'
import { contributionListWhere } from './contributions'

const router = Router()
const prisma = getPrisma()
// Garde-fou mémoire : bien au-delà du volume de l'association
const MAX_ROWS = 50_000

async function send(req: Request, res: Response, p: { name: string; sheetName: string; title: string; columns: XlsxColumn[]; rows: XlsxRow[]; filters?: Record<string, unknown> }) {
  if (p.rows.length > MAX_ROWS) throw new AppError('BUSINESS_RULE', `Export trop volumineux (${p.rows.length} lignes) : affinez les filtres.`, 400)
  const buffer = await buildXlsx(p)
  await audit({
    req, userId: req.user!.userId, userName: req.user!.email, action: 'EXPORT',
    entityType: 'Export', entityId: p.name, details: { lignes: p.rows.length, ...(p.filters ? { filtres: p.filters } : {}) } as never,
  })
  const day = new Date().toLocaleDateString('fr-CA', { timeZone: 'Africa/Douala' })
  res.setHeader('Content-Type', XLSX_MIME)
  res.setHeader('Content-Disposition', `attachment; filename="${p.name}-${day}.xlsx"`)
  res.setHeader('Cache-Control', 'no-store')
  res.send(buffer)
}

const queryOf = (req: Request) => req.query as Record<string, string | undefined>

// GET /api/exports/membres.xlsx — membres actifs (mêmes filtres que la liste)
router.get('/membres.xlsx', authenticate, requireLevel(3), async (req, res) => {
  const { search, groupe, statut, profilFinancier } = queryOf(req)
  const membres = await prisma.membre.findMany({
    where: {
      isActive: true,
      ...(search && { user: { fullName: { contains: search.slice(0, 80), mode: 'insensitive' as const } } }),
      ...(groupe && { groupe: groupe as never }),
      ...(statut && { statut: statut as never }),
      ...(profilFinancier && { profilFinancier: profilFinancier as never }),
    },
    include: { user: { select: { fullName: true, email: true } } },
    orderBy: { user: { fullName: 'asc' } },
  })
  await send(req, res, {
    name: 'membres', sheetName: 'Membres', title: 'Liste des membres', filters: { search, groupe, statut, profilFinancier },
    columns: [
      { header: 'Matricule', key: 'matricule', width: 16 },
      { header: 'Nom', key: 'nom', width: 28 },
      { header: 'E-mail', key: 'email', width: 28 },
      { header: 'Téléphone', key: 'phone', width: 16 },
      { header: 'Catégorie', key: 'categorie', width: 18 },
      { header: 'Groupe', key: 'groupe', width: 16 },
      { header: 'Statut', key: 'statut', width: 16 },
      { header: 'Profil financier', key: 'profil', width: 16 },
      { header: 'Adhésion', key: 'adhesion', width: 14 },
    ],
    rows: membres.map(m => ({
      matricule: m.memberId, nom: m.user.fullName, email: m.user.email, phone: m.phone,
      categorie: m.categorie, groupe: m.groupe, statut: m.statut, profil: m.profilFinancier, adhesion: dateFr(m.dateAdhesion),
    })),
  })
})

// GET /api/exports/rubriques.xlsx
router.get('/rubriques.xlsx', authenticate, requireLevel(3), async (req, res) => {
  const { status, fiscalYear } = queryOf(req)
  const [rubriques, totals] = await Promise.all([
    prisma.rubrique.findMany({
      where: { ...(status && { status: status as never }), ...(fiscalYear && { fiscalYear: parseInt(fiscalYear, 10) || undefined }) },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.contribution.groupBy({ by: ['rubriqueId'], where: { statut: 'CONFIRME' }, _sum: { montant: true }, _count: true }),
  ])
  const byId = new Map(totals.map(t => [t.rubriqueId, t]))
  const refunded = await refundsByRubrique()
  await send(req, res, {
    name: 'rubriques', sheetName: 'Rubriques', title: 'Rubriques budgétaires', filters: { status, fiscalYear },
    columns: [
      { header: 'Code', key: 'code', width: 14 },
      { header: 'Titre', key: 'titre', width: 32 },
      { header: 'Type', key: 'type', width: 14 },
      { header: 'Priorité', key: 'priorite', width: 12 },
      { header: 'Statut', key: 'statut', width: 12 },
      { header: 'Année', key: 'annee', width: 10 },
      { header: 'Travailleur', key: 'travailleur', width: 14, type: 'amount' },
      { header: 'Étudiant', key: 'etudiant', width: 14, type: 'amount' },
      { header: 'Couple', key: 'couple', width: 14, type: 'amount' },
      { header: 'Objectif', key: 'objectif', width: 16, type: 'amount' },
      { header: 'Collecté (net des remboursements)', key: 'collecte', width: 20, type: 'amount' },
      { header: 'Contributions confirmées', key: 'nb', width: 14, type: 'count' },
    ],
    rows: rubriques.map(r => ({
      code: r.code, titre: r.title, type: r.type, priorite: r.priority, statut: r.status, annee: String(r.fiscalYear),
      travailleur: r.amountTravailleur ?? 0, etudiant: r.amountEtudiant ?? 0, couple: r.amountCouple ?? 0,
      objectif: r.targetAmount ?? 0, collecte: (byId.get(r.id)?._sum.montant ?? 0) - (refunded.get(r.id) ?? 0), nb: byId.get(r.id)?._count ?? 0,
    })),
  })
})

// GET /api/exports/contributions.xlsx — mêmes filtres et périmètre que GET /api/contributions
router.get('/contributions.xlsx', authenticate, requireLevel(3), async (req, res) => {
  const { statut, rubriqueId, membreId, localisation, search, modePaiement, year, month } = queryOf(req)
  const filters = { statut, rubriqueId, membreId, localisation, search, modePaiement, year, month }
  const contributions = await prisma.contribution.findMany({
    where: contributionListWhere({ userId: req.user!.userId, role: req.user!.role }, filters),
    include: {
      membre: { include: { user: { select: { fullName: true } } } },
      contributeurExterne: { select: { nom: true } },
      rubrique: { select: { code: true } },
      collecteur: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  await send(req, res, {
    name: 'contributions', sheetName: 'Contributions', title: 'Historique des contributions', filters,
    columns: [
      { header: 'Date', key: 'date', width: 18 },
      { header: 'Contributeur', key: 'membre', width: 28 },
      { header: 'Rubrique', key: 'rubrique', width: 14 },
      { header: 'Montant', key: 'montant', width: 16, type: 'amount' },
      { header: 'Mode', key: 'mode', width: 16 },
      { header: 'Statut', key: 'statut', width: 14 },
      { header: 'Emplacement des fonds', key: 'localisation', width: 24 },
      { header: 'Collecteur', key: 'collecteur', width: 24 },
      { header: 'Confirmée le', key: 'confirmee', width: 18 },
      { header: 'Référence', key: 'reference', width: 20 },
    ],
    rows: contributions.map(c => ({
      date: dateFr(c.createdAt, true),
      membre: c.membre?.user.fullName ?? c.contributeurExterne?.nom ?? '',
      rubrique: c.rubrique.code,
      montant: c.montant,
      mode: LABELS.mode[c.modePaiement] ?? c.modePaiement,
      statut: LABELS.statut[c.statut] ?? c.statut,
      localisation: c.statut === 'CONFIRME' ? LABELS.localisation[c.localisationFonds] ?? c.localisationFonds : '',
      collecteur: c.collecteur?.fullName ?? '',
      confirmee: dateFr(c.confirmedAt, true),
      reference: c.referencePaiement ?? c.externalTransactionId ?? '',
    })),
  })
})

// GET /api/exports/collectes/:id.xlsx — contributions d'une collecte publique
// (réponses aux champs personnalisés incluses), réservé à la trésorerie
router.get('/collectes/:id.xlsx', authenticate, requireLevel(4), async (req, res) => {
  const collecte = await prisma.collectePublique.findUnique({ where: { id: String(req.params.id) } })
  if (!collecte) throw new AppError('NOT_FOUND', 'Collecte introuvable', 404)
  const champs = (Array.isArray(collecte.champsPersonnalises) ? collecte.champsPersonnalises : []) as unknown as ChampPersonnalise[]
  const contributions = await prisma.contribution.findMany({
    where: { rubriqueId: collecte.rubriqueId, statut: { in: ['CONFIRME', 'EN_ATTENTE_CONFIRMATION'] } },
    include: { membre: { include: { user: { select: { fullName: true } } } }, contributeurExterne: { select: { nom: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
  })
  const champValue = (v: unknown) => v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'Oui' : 'Non') : typeof v === 'number' ? v : String(v)
  await send(req, res, {
    name: `collecte-${collecte.publicSlug}`, sheetName: 'Contributions', title: `Contributions — ${collecte.titre}`, filters: { collecteId: collecte.id },
    columns: [
      { header: 'Date', key: 'date', width: 18 },
      { header: 'Nom', key: 'nom', width: 26 },
      { header: 'Type', key: 'type', width: 12 },
      { header: 'Téléphone', key: 'phone', width: 16 },
      { header: 'Montant', key: 'montant', width: 16, type: 'amount' },
      { header: 'Statut', key: 'statut', width: 14 },
      { header: 'Mode', key: 'mode', width: 16 },
      ...champs.map(ch => ({ header: ch.label, key: `champ_${ch.key}`, width: 18 })),
    ],
    rows: contributions.map(c => {
      const valeurs = (c.valeursChamps ?? {}) as Record<string, unknown>
      return {
        date: dateFr(c.createdAt, true),
        nom: c.membre?.user.fullName ?? c.contributeurExterne?.nom ?? 'Inconnu',
        type: c.membre ? 'Membre' : 'Externe',
        phone: c.contributeurExterne?.phone ?? '',
        montant: c.montant,
        statut: LABELS.statut[c.statut] ?? c.statut,
        mode: LABELS.mode[c.modePaiement] ?? c.modePaiement,
        ...Object.fromEntries(champs.map(ch => [`champ_${ch.key}`, champValue(valeurs[ch.key])])),
      }
    }),
  })
})

export { router as exportsRouter }
