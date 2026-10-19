// Refonte des documents : gabarit commun, nouveaux documents (relevé annuel,
// facture de prestation, avis de remboursement), rapport par mois, et
// vérification publique par code QR (lien signé, données minimales).
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/index'
import { getPrisma } from '../src/lib/prisma'
import { verificationSignature } from '../src/services/documents/document-kit'
import { generateReceiptHtml } from '../src/services/receipt'
import { testCookie } from './helpers/session'

const prisma = getPrisma()
const RUN = `doc-${Date.now()}`
type Person = { id: string; email: string; role: string }
let resp: Person, collecteur: Person, membre: Person
let membreId = ''
let contributionId = ''
let prestationId = ''

async function person(tag: string, role: string): Promise<Person> {
  const u = await prisma.user.create({
    data: { memberId: `${RUN}-${tag}`, firstName: tag, lastName: 'Essomba', fullName: `${tag} Essomba`, email: `${RUN}-${tag}@test.local`, passwordHash: 'disabled', role: role as never, mustChangePassword: false },
  })
  return { id: u.id, email: u.email, role }
}
const get = async (p: Person, path: string) => request(app).get(path).set('Cookie', await testCookie({ userId: p.id, role: p.role, email: p.email })).buffer(true)
  .parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))) })
const isPdf = (body: Buffer) => body.subarray(0, 5).toString() === '%PDF-'

beforeAll(async () => {
  resp = await person('resp', 'RESPONSABLE')
  collecteur = await person('col', 'COLLECTEUR')
  membre = await person('Awa', 'MEMBRE')
  membreId = (await prisma.membre.create({ data: { userId: membre.id, memberId: `CEM-2026-9${String(Date.now()).slice(-5)}`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })).id
  const rubriqueId = (await prisma.rubrique.create({
    data: { code: `${RUN}-R`, title: 'Contribution annuelle', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), status: 'OUVERTE', createdById: resp.id, createdByName: 'R' },
  })).id
  contributionId = (await prisma.contribution.create({ data: { membreId, rubriqueId, montant: 5000, modePaiement: 'ESPECES', statut: 'CONFIRME', confirmedAt: new Date(), collecteurId: collecteur.id } })).id
  prestationId = (await prisma.prestation.create({
    data: { reference: `PREST-${RUN}`, titre: 'Chorale pour mariage', commanditaire: 'Famille Mbarga', tarifBase: 100000, rabaisCommanditaire: 10000, rabaisPercent: 10, tarifFinal: 90000, acompte: 0, solde: 90000, totalEntrees: 0, totalCours: 0, commissionPercent: 0 },
  })).id
})

describe('Documents PDF', () => {
  it('reçu : gabarit commun avec code QR de vérification et identité de la communauté', async () => {
    const html = await generateReceiptHtml(contributionId)
    expect(html).toContain('class="masthead"')
    expect(html).toContain('<svg')
    expect(html).toContain(`/verifier/recu/${contributionId}?s=`)
    expect(html).toContain('@font-face')
  })

  it('relevé annuel : le membre obtient le sien ; un responsable celui d\'un membre', async () => {
    const mine = await get(membre, `/api/documents/releve/me?year=${new Date().getFullYear()}`)
    expect(mine.status).toBe(200)
    expect(isPdf(mine.body)).toBe(true)
    expect((await get(resp, `/api/documents/releve/${membreId}`)).status).toBe(200)
    expect((await get(collecteur, `/api/documents/releve/${membreId}`)).status).toBe(403)
  })

  it('facture de prestation et rapport mensuel : PDF ; accès refusé au collecteur', async () => {
    const facture = await get(resp, `/api/documents/prestations/${prestationId}/facture`)
    expect(facture.status).toBe(200)
    expect(isPdf(facture.body)).toBe(true)
    expect((await get(collecteur, `/api/documents/prestations/${prestationId}/facture`)).status).toBe(403)
    const rapport = await get(resp, '/api/stats/financial-report.pdf?year=2026&month=3')
    expect(rapport.status).toBe(200)
    expect(isPdf(rapport.body)).toBe(true)
    expect((await get(resp, '/api/stats/financial-report.pdf?year=2026&month=13')).status).toBe(400)
  })
})

describe('Vérification publique', () => {
  it('lien signé : données minimales, initiales seulement', async () => {
    const res = await request(app).get(`/api/public/verifier/recu/${contributionId}?s=${verificationSignature('recu', contributionId)}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ type: 'Reçu', montant: 5000, statut: 'CONFIRME', payeur: 'A. E.' })
    expect(JSON.stringify(res.body)).not.toContain('Essomba')
  })

  it('signature altérée ou autre type : document non authentifié', async () => {
    expect((await request(app).get(`/api/public/verifier/recu/${contributionId}?s=AAAAAAAAAAAAAAAA`)).status).toBe(404)
    expect((await request(app).get(`/api/public/verifier/facture/${contributionId}?s=${verificationSignature('recu', contributionId)}`)).status).toBe(404)
  })
})
