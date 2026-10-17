// Phase 1 — fiabilité de l'argent : un paiement réparti (lot) est confirmé au
// total, en bloc (preuve P1 de l'audit). Prestataire simulé : aucun appel réel.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { getPrisma } from '../src/lib/prisma'
import { createPaymentBatch } from '../src/services/payment-batch.service'
import {
  applyProviderOutcome,
  CONTRIBUTION_SYNC_SELECT,
  syncPaymentContributionStatus,
} from '../src/services/payment-status.service'

const prisma = getPrisma()
const RUN = `p1-${Date.now()}`
let remoteAmount = 0
let remoteStatus = 'success'
const realFetch = globalThis.fetch

let membreId = ''
const rubriqueIds: string[] = []

beforeAll(async () => {
  process.env.YELII_COLLECT_API_KEY ??= 'cle-factice-de-test' // jamais envoyée : fetch simulé
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    if (u.includes('/collect/status/')) {
      return new Response(JSON.stringify({ success: true, data: { status: remoteStatus, amount: remoteAmount, netCredited: remoteAmount } }), { status: 200 })
    }
    throw new Error(`Appel externe bloqué par le test : ${u}`)
  }) as typeof fetch

  const user = await prisma.user.create({
    data: { memberId: `${RUN}-u`, firstName: 'Lot', lastName: 'Test', fullName: 'Lot Test', email: `${RUN}@test.local`, passwordHash: 'disabled', role: 'MEMBRE', mustChangePassword: false },
  })
  const membre = await prisma.membre.create({ data: { userId: user.id, memberId: `${RUN}-m`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE', profilFinancier: 'TRAVAILLEUR' } })
  membreId = membre.id
  for (const code of ['A', 'B']) {
    const r = await prisma.rubrique.create({
      data: { code: `${RUN}-${code}`, title: `Rubrique ${code}`, type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), createdById: user.id, createdByName: 'Test' },
    })
    rubriqueIds.push(r.id)
  }
})

afterAll(() => {
  globalThis.fetch = realFetch
})

let batchSeq = 0
async function newBatch() {
  // Montants distincts : un lot identique serait reconnu (idempotence) et réutilisé
  batchSeq += 1
  const batch = await createPaymentBatch({
    idempotencyKey: `${RUN}-${batchSeq}`, membreId, budgetAmount: 3000 + batchSeq,
    allocations: [{ rubriqueId: rubriqueIds[0], montant: 1000 + batchSeq }, { rubriqueId: rubriqueIds[1], montant: 2000 }],
    modePaiement: 'YELII', mobileMoneyPhone: '670000000', paymentChannel: 'MTN',
  })
  const txId = `${RUN}-tx-${Math.random()}`
  await prisma.contribution.updateMany({ where: { paymentBatchId: batch.batchId }, data: { paymentStatus: 'PROCESSING', externalTransactionId: txId } })
  await prisma.paymentBatch.update({ where: { id: batch.batchId }, data: { externalTransactionId: txId } })
  return { batch, txId }
}

describe('P1 — paiement réparti', () => {
  it('le total débité confirme TOUTES les lignes, en bloc, sur le portefeuille électronique', async () => {
    const { batch, txId } = await newBatch()
    remoteStatus = 'success'
    remoteAmount = batch.totalToPay
    const first = await prisma.contribution.findFirstOrThrow({ where: { externalTransactionId: txId }, select: CONTRIBUTION_SYNC_SELECT })
    const res = await syncPaymentContributionStatus(first)
    expect(res.statut).toBe('CONFIRME')

    const lines = await prisma.contribution.findMany({ where: { externalTransactionId: txId } })
    expect(lines).toHaveLength(2)
    expect(lines.every(l => l.statut === 'CONFIRME' && l.localisationFonds === 'PORTEFEUILLE_ELECTRONIQUE')).toBe(true)
    expect((await prisma.paymentBatch.findUniqueOrThrow({ where: { id: batch.batchId } })).status).toBe('CONFIRMED')
  }, 60_000)

  it('un montant différent du total ne confirme rien', async () => {
    const { txId, batch } = await newBatch()
    remoteAmount = batch.totalToPay - 1
    const result = await applyProviderOutcome(txId, { provider: 'yelii', status: 'success', amount: remoteAmount, source: 'webhook' })
    expect(result).toBe('mismatch')
    const lines = await prisma.contribution.findMany({ where: { externalTransactionId: txId } })
    expect(lines.every(l => l.statut === 'EN_ATTENTE_CONFIRMATION')).toBe(true)
  })

  it('un échec annule toutes les lignes ; un second événement est ignoré', async () => {
    const { txId, batch } = await newBatch()
    expect(await applyProviderOutcome(txId, { provider: 'yelii', status: 'failed', source: 'webhook' })).toBe('failed')
    expect(await applyProviderOutcome(txId, { provider: 'yelii', status: 'success', amount: batch.totalToPay, source: 'webhook' })).toBe('already_processed')
    const lines = await prisma.contribution.findMany({ where: { externalTransactionId: txId } })
    expect(lines.every(l => l.statut === 'ANNULE')).toBe(true)
    expect((await prisma.paymentBatch.findUniqueOrThrow({ where: { id: batch.batchId } })).status).toBe('FAILED')
  })

  it('transaction inconnue', async () => {
    expect(await applyProviderOutcome(`${RUN}-inconnue`, { provider: 'yelii', status: 'success', source: 'webhook' })).toBe('unknown_transaction')
  })
})
