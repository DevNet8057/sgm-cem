export const formatAmount = (amount: number | null | undefined): string => {
  if (amount == null) return '—'
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: 'XAF', maximumFractionDigits: 0,
  }).format(amount)
}
