// Phase 4.6 — exports Excel côté serveur : toutes les lignes du périmètre, mêmes
// filtres que les listes, droits par niveau, journalisation, pas de formule.
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import ExcelJS from 'exceljs'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `exp-${Date.now()}`
type Person = { id: string; email: string; role: string }
let tresorier: Person, responsable: Person, collecteur: Person, membre: Person
let rubriqueId = ''
let collecteId = ''

async function person(tag: string, role: string, fullName = `${tag} T`): Promise<Person> {
  const u = await prisma.user.create({
    data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'T', fullName, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: role as never, mustChangePassword: false },
  })
  return { id: u.id, email: u.email, role }
}

async function download(p: Person, path: string) {
  const cookie = await testCookie({ userId: p.id, role: p.role, email: p.email })
  return request(app).get(path).set('Cookie', cookie).buffer(true)
    .parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))) })
}

async function sheetOf(body: Buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(body as unknown as ExcelJS.Buffer)
  return wb.worksheets[0]
}

beforeAll(async () => {
  tresorier = await person('tres', 'TRESORIER')
  responsable = await person('resp', 'RESPONSABLE')
  collecteur = await person('col', 'COLLECTEUR')
  membre = await person('mem', 'MEMBRE', '=HYPERLINK("http://exemple.invalid","clic")')
  const m = await prisma.membre.create({ data: { userId: membre.id, memberId: `${RUN}-mm`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE', phone: '690000000' } })
  rubriqueId = (await prisma.rubrique.create({
    data: { code: `${RUN}-R`, title: 'Rubrique export', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), status: 'OUVERTE', createdById: tresorier.id, createdByName: 'T' },
  })).id
  // 120 lignes : au-delà d'une page de l'API (100)
  await prisma.contribution.createMany({
    data: Array.from({ length: 120 }, (_, i) => ({ membreId: m.id, rubriqueId, collecteurId: collecteur.id, montant: 1000 + i, modePaiement: 'ESPECES' as const, statut: i % 2 ? 'CONFIRME' as const : 'EN_ATTENTE_CONFIRMATION' as const })),
  })
  collecteId = (await prisma.collectePublique.create({
    data: {
      rubriqueId, titre: 'Collecte export', publicSlug: `${RUN}-c`, description: 'Test', createdById: tresorier.id, createdByName: 'T',
      champsPersonnalises: [{ key: 'taille', label: 'Taille', type: 'text', required: false }],
    } as never,
  })).id
})

describe('Exports Excel côté serveur', () => {
  it('contributions : toutes les lignes filtrées, montants numériques, export journalisé', async () => {
    const res = await download(tresorier, `/api/exports/contributions.xlsx?rubriqueId=${rubriqueId}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('spreadsheetml')
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="contributions-\d{4}-\d{2}-\d{2}\.xlsx"/)
    const sheet = await sheetOf(res.body)
    expect(sheet.rowCount - 3).toBe(120)
    expect(sheet.getRow(3).getCell(4).value).toBe('Montant')
    expect(typeof sheet.getRow(4).getCell(4).value).toBe('number')
    const log = await prisma.auditLog.findFirst({ where: { userId: tresorier.id, action: 'EXPORT', entityId: 'contributions' }, orderBy: { createdAt: 'desc' } })
    expect(log?.details).toMatchObject({ lignes: 120, filtres: { rubriqueId } })
  })

  it('filtre de statut appliqué ; statut inconnu refusé', async () => {
    const sheet = await sheetOf((await download(tresorier, `/api/exports/contributions.xlsx?rubriqueId=${rubriqueId}&statut=CONFIRME`)).body)
    expect(sheet.rowCount - 3).toBe(60)
    expect((await download(tresorier, '/api/exports/contributions.xlsx?statut=PIRATE')).status).toBe(400)
  })

  it('un texte commençant par « = » reste du texte, jamais une formule', async () => {
    const sheet = await sheetOf((await download(tresorier, `/api/exports/contributions.xlsx?rubriqueId=${rubriqueId}`)).body)
    const cell = sheet.getRow(4).getCell(2)
    expect(cell.type).toBe(ExcelJS.ValueType.String)
    expect(String(cell.value)).toContain('=HYPERLINK')
  })

  it('membres et rubriques : nombres sans « FCFA » pour les comptages', async () => {
    const membres = await download(responsable, `/api/exports/membres.xlsx?search=${encodeURIComponent('=HYPERLINK')}`)
    expect(membres.status).toBe(200)
    expect((await sheetOf(membres.body)).getRow(4).getCell(4).value).toBe('690000000')
    const rub = await sheetOf((await download(tresorier, '/api/exports/rubriques.xlsx')).body)
    const header = rub.getRow(3)
    const nbCol = (header.values as unknown[]).indexOf('Contributions confirmées')
    const row = Array.from({ length: rub.rowCount - 3 }, (_, i) => rub.getRow(i + 4)).find(r => r.getCell(1).value === `${RUN}-R`)!
    expect(row.getCell(nbCol).value).toBe(60)
    expect(row.getCell(nbCol).numFmt).toBe('#,##0')
  })

  it('collecte : colonnes des champs personnalisés, réservé à la trésorerie', async () => {
    const res = await download(tresorier, `/api/exports/collectes/${collecteId}.xlsx`)
    expect(res.status).toBe(200)
    const sheet = await sheetOf(res.body)
    expect(sheet.getRow(3).getCell(8).value).toBe('Taille')
    expect(sheet.rowCount - 3).toBe(120)
    expect((await download(responsable, `/api/exports/collectes/${collecteId}.xlsx`)).status).toBe(403)
    expect((await download(tresorier, '/api/exports/collectes/inconnue.xlsx')).status).toBe(404)
  })

  it('droits : ni collecteur ni membre', async () => {
    expect((await download(collecteur, '/api/exports/contributions.xlsx')).status).toBe(403)
    expect((await download(membre, '/api/exports/membres.xlsx')).status).toBe(403)
  })
})
