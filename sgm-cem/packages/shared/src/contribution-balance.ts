export type ProfilFinancier = 'TRAVAILLEUR' | 'ETUDIANT' | 'COUPLE'

export interface RubriqueAmounts {
  amountTravailleur?: number | null
  amountEtudiant?: number | null
  amountCouple?: number | null
}

/** Montant attendu pour une rubrique selon le profil financier du membre. */
export function resolveDueAmount(profilFinancier: ProfilFinancier, amounts: RubriqueAmounts): number | null {
  const value =
    profilFinancier === 'ETUDIANT' ? amounts.amountEtudiant :
    profilFinancier === 'COUPLE' ? amounts.amountCouple :
    amounts.amountTravailleur
  return value ?? null
}

export interface RemainingBalance {
  dueAmount: number | null
  confirmedAmount: number
  pendingAmount: number
  remainingAmount: number | null
}

interface ContributionAmount {
  montant: number
  statut: 'EN_ATTENTE_CONFIRMATION' | 'CONFIRME' | 'LITIGE' | 'ANNULE'
}

/** Solde restant dû sur une rubrique, à partir des contributions déjà déclarées par le membre. */
export function calculateRemainingBalance(
  profilFinancier: ProfilFinancier,
  amounts: RubriqueAmounts,
  contributions: ContributionAmount[]
): RemainingBalance {
  const dueAmount = resolveDueAmount(profilFinancier, amounts)
  const confirmedAmount = contributions
    .filter(c => c.statut === 'CONFIRME')
    .reduce((sum, c) => sum + c.montant, 0)
  const pendingAmount = contributions
    .filter(c => c.statut === 'EN_ATTENTE_CONFIRMATION')
    .reduce((sum, c) => sum + c.montant, 0)
  const remainingAmount = dueAmount == null ? null : Math.max(0, dueAmount - confirmedAmount)

  return { dueAmount, confirmedAmount, pendingAmount, remainingAmount }
}
