import { describe, it, expect } from 'vitest'
import { calculateAmountWithCommission, YELII_COMMISSION_RATE } from '@sgm-cem/shared'

describe('calculateAmountWithCommission (§1bis — commission Yelii payée par le contributeur)', () => {
  it('5 000 FCFA dû produit exactement 5 129 FCFA à payer (exemple du doc)', () => {
    const r = calculateAmountWithCommission(5000)
    expect(r.dueAmount).toBe(5000)
    expect(r.totalToPay).toBe(5129)
    expect(r.commissionAmount).toBe(129)
  })

  it('le net crédité par Yelii couvre TOUJOURS au moins le montant dû', () => {
    for (const due of [1, 500, 1000, 3000, 5000, 10000, 25000, 100000]) {
      const { totalToPay } = calculateAmountWithCommission(due)
      const netCredited = totalToPay - totalToPay * YELII_COMMISSION_RATE
      expect(netCredited).toBeGreaterThanOrEqual(due)
    }
  })

  it('utilise la division par (1 - taux), jamais la multiplication par (1 + taux)', () => {
    // La multiplication naïve sous-évaluerait : 5000 * 1.025 = 5125 (net < 5000).
    const naiveWrong = Math.ceil(5000 * (1 + YELII_COMMISSION_RATE))
    const correct = calculateAmountWithCommission(5000).totalToPay
    expect(correct).toBe(5129)
    expect(correct).toBeGreaterThan(naiveWrong) // 5129 > 5125
  })

  it('arrondit le total au-dessus (Math.ceil), jamais en dessous', () => {
    const { totalToPay } = calculateAmountWithCommission(1000) // 1000/0.975 = 1025.64 → 1026
    expect(totalToPay).toBe(1026)
  })
})
