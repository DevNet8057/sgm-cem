/**
 * Calcul de la commission Mobile Money Yelii — SOURCE UNIQUE (frontend + backend).
 *
 * Règle métier §1bis de PAYMENT_FLOWS_SGM_CEM_2.md :
 * c'est le CONTRIBUTEUR qui supporte la commission de 2,5 %, pas l'organisation.
 * On majore donc le montant envoyé à Yelii pour que le NET crédité couvre
 * exactement (ou légèrement au-dessus) le montant dû à la rubrique.
 *
 * ⚠️ NE JAMAIS dupliquer cette logique ailleurs. Si le taux Yelii change,
 * ce fichier est le SEUL endroit à modifier.
 */

/** Taux de commission Yelii — 2,5 %. Garder synchronisé avec le taux réel Yelii. */
export const YELII_COMMISSION_RATE = 0.025

export interface AmountWithCommission {
  /** Montant réellement dû à la rubrique (ce que le membre doit). */
  dueAmount: number
  /** Frais de transaction supportés par le contributeur (= totalToPay - dueAmount). */
  commissionAmount: number
  /** Montant majoré à envoyer à Yelii et à débiter sur le Mobile Money. */
  totalToPay: number
}

/**
 * Calcule le montant à envoyer à Yelii pour que le montant NET crédité
 * corresponde exactement au montant dû par le contributeur.
 *
 * Formule NON négociable : totalToPay = Math.ceil(dueAmount / (1 - taux)).
 * Diviser par (1 - taux) — et NON multiplier par (1 + taux), qui sous-évaluerait
 * le net crédité et léserait l'organisation. Arrondi AU-DESSUS (Math.ceil) pour
 * ne jamais recevoir moins que le montant dû.
 *
 * Exemple : dueAmount = 5000 → totalToPay = ceil(5000 / 0.975) = 5129 (commission 129).
 *
 * @param rate Taux effectif — configurable depuis le panneau développeur
 *             (clé YELII_COMMISSION_RATE en base). Par défaut le taux statique.
 *             La FORMULE reste ici l'unique source, jamais dupliquée.
 */
export function calculateAmountWithCommission(dueAmount: number, rate: number = YELII_COMMISSION_RATE): AmountWithCommission {
  const totalToPay = Math.ceil(dueAmount / (1 - rate))
  const commissionAmount = totalToPay - dueAmount
  return { dueAmount, commissionAmount, totalToPay }
}
