// Phase 1.2 — initiation Yelii incertaine : le webhook qui arrive ensuite avec
// un identifiant inconnu est rattaché à la tentative, ou signalé si ambigu.
import { describe, it, expect, beforeAll } from 'vitest'
import { getPrisma } from '../src/lib/prisma'
import { linkOrphanYeliiTransaction } from '../src/services/payment-attempt.service'
import { applyProviderOutcome } from '../src/services/payment-status.service'

const prisma = getPrisma()
const RUN = `pa-${Date.now()}`
let rubriqueId = ''
let membreId = ''

async function pendingContribution(amount: number) {
  return prisma.contribution.create({
    data: { membreId, rubriqueId, montant: amount, amountChargedToPayer: amount + 26, modePaiement: 'YELII', statut: 'EN_ATTENTE_CONFIRMATION', paymentStatus: 'PROCESSING', localisationFonds: 'EN_TRANSIT' },
  })
}

beforeAll(async () => {
  const user = await prisma.user.create({ data: { memberId: `${RUN}-u`, firstName: 'T', lastName: 'A', fullName: 'T A', email: `${RUN}@test.local`, passwordHash: 'disabled', role: 'MEMBRE', mustChangePassword: false } })
  membreId = (await prisma.membre.create({ data: { userId: user.id, memberId: `${RUN}-m`, categorie: 'MCE_EN_SERVICE', groupe: 'TEMPLE' } })).id
  rubriqueId = (await prisma.rubrique.create({ data: { code: `${RUN}-R`, title: 'R', type: 'PONCTUELLE', fiscalYear: 2026, openDate: new Date(), createdById: user.id, createdByName: 'T' } })).id
})

describe('Webhook orphelin', () => {
  it('une seule tentative incertaine correspondante : rattachée puis confirmée', async () => {
    const c = await pendingContribution(1000)
    const phone = `6${String(Date.now()).slice(-8)}`
    await prisma.paymentAttempt.create({ data: { provider: 'YELII', status: 'UNCERTAIN', amount: 1026, phone, contributionIds: [c.id], source: 'payments_initiate' } })
    const tx = `${RUN}-tx1`
    expect(await linkOrphanYeliiTransaction(tx, { amount: 1026, senderPhone: `+237${phone}` })).toBe(true)
    expect(await applyProviderOutcome(tx, { provider: 'yelii', status: 'success', amount: 1026, source: 'webhook' })).toBe('confirmed')
    expect((await prisma.contribution.findUniqueOrThrow({ where: { id: c.id } })).statut).toBe('CONFIRME')
  }, 60_000)

  it('deux tentatives possibles : aucun rattachement automatique', async () => {
    const phone = `6${String(Date.now() + 7).slice(-8)}`
    for (const amount of [2000, 2000]) {
      const c = await pendingContribution(amount - 26)
      await prisma.paymentAttempt.create({ data: { provider: 'YELII', status: 'UNCERTAIN', amount, phone, contributionIds: [c.id], source: 'payments_initiate' } })
    }
    expect(await linkOrphanYeliiTransaction(`${RUN}-tx2`, { amount: 2000, senderPhone: phone })).toBe(false)
  })

  it('aucune tentative : pas de rattachement', async () => {
    expect(await linkOrphanYeliiTransaction(`${RUN}-tx3`, { amount: 999999, senderPhone: '699999999' })).toBe(false)
  })
})
