/** Contrat partagé pour un paiement distribué entre plusieurs rubriques. */

export const MAX_PAYMENT_BATCH_LINES = 50

export type PaymentBatchStatus = 'PENDING' | 'CONFIRMED' | 'FAILED'

/** Une allocation est exprimée en FCFA entiers. */
export interface PaymentAllocation {
  rubriqueId: string
  montant: number
}

/** Demande de création d'un lot de paiement. */
export interface PaymentBatchInitiationRequest {
  membreId: string
  budget: number
  allocations: PaymentAllocation[]
}

/** Réponse renvoyée pour un lot de paiement. */
export interface PaymentBatchResponse {
  batchId: string
  status: PaymentBatchStatus
  membreId: string
  budget: number
  allocations: PaymentAllocation[]
  totalAllocated: number
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function toBigIntAmount(value: number): bigint {
  if (!isPositiveSafeInteger(value)) {
    throw new RangeError('Les montants doivent être des entiers positifs sûrs')
  }
  return BigInt(value)
}

/** Valide les lignes : bornes, identifiants non vides et rubriques uniques. */
export function validateAllocations(allocations: readonly PaymentAllocation[]): boolean {
  if (!Array.isArray(allocations) || allocations.length === 0 || allocations.length > MAX_PAYMENT_BATCH_LINES) {
    return false
  }

  const rubriqueIds = new Set<string>()
  return allocations.every(allocation => {
    if (
      !allocation ||
      typeof allocation.rubriqueId !== 'string' ||
      allocation.rubriqueId.trim() === '' ||
      rubriqueIds.has(allocation.rubriqueId) ||
      !isPositiveSafeInteger(allocation.montant)
    ) {
      return false
    }
    rubriqueIds.add(allocation.rubriqueId)
    return true
  })
}

/** Vérifie les allocations et l'invariant budget >= somme des lignes. */
export function validatePaymentBatchRequest(request: PaymentBatchInitiationRequest): boolean {
  if (
    !request ||
    typeof request.membreId !== 'string' ||
    request.membreId.trim() === '' ||
    !isPositiveSafeInteger(request.budget) ||
    !validateAllocations(request.allocations)
  ) {
    return false
  }

  try {
    return BigInt(request.budget) >= sumAllocationsAsBigInt(request.allocations)
  } catch {
    return false
  }
}

function sumAllocationsAsBigInt(allocations: readonly PaymentAllocation[]): bigint {
  if (!validateAllocations(allocations)) {
    throw new RangeError('Allocations invalides')
  }
  return allocations.reduce((sum, allocation) => sum + toBigIntAmount(allocation.montant), 0n)
}

/** Additionne sans perte de précision et refuse un résultat hors Number sûr. */
export function sumAllocations(allocations: readonly PaymentAllocation[]): number {
  const total = sumAllocationsAsBigInt(allocations)
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('La somme des allocations dépasse la précision sûre')
  }
  return Number(total)
}

/**
 * Répartit un montant entier selon les poids `montant` des lignes.
 * Les quotients sont tronqués, puis les plus grands restes reçoivent chacun
 * une unité, les égalités étant départagées par l'index d'origine.
 */
export function distributeAmountProportionally(
  amount: number,
  allocations: readonly PaymentAllocation[],
): PaymentAllocation[] {
  const total = toBigIntAmount(amount)
  const weightTotal = sumAllocationsAsBigInt(allocations)

  const shares = allocations.map((allocation, index) => {
    const numerator = total * BigInt(allocation.montant)
    return {
      index,
      quotient: numerator / weightTotal,
      remainder: numerator % weightTotal,
    }
  })

  let unitsToDistribute = total - shares.reduce((sum, share) => sum + share.quotient, 0n)
  shares
    .slice()
    .sort((left, right) => {
      if (left.remainder === right.remainder) return left.index - right.index
      return left.remainder > right.remainder ? -1 : 1
    })
    .forEach(share => {
      if (unitsToDistribute > 0n) {
        share.quotient += 1n
        unitsToDistribute -= 1n
      }
    })

  return shares
    .sort((left, right) => left.index - right.index)
    .map(share => ({
      rubriqueId: allocations[share.index].rubriqueId,
      montant: Number(share.quotient),
    }))
}

