export interface ContributionActions {
  canConfirm: boolean
  canRefuse: boolean
  canDispute: boolean
  canResolveDispute: boolean
  canGrantConfirmation: boolean
}

export interface ContributionConfirmationAuthorization {
  treasurerId: string
  grantedById: string
  grantedAt: string
  expiresAt: string
  motif: string
  consumedAt?: string
  revokedAt?: string
}

export interface ContributionConfirmedBy {
  id: string
  fullName: string
  role: string
}

export interface ContributionAccessMetadata {
  actions: ContributionActions
  confirmedBy: ContributionConfirmedBy | null
  confirmationAuthorization: ContributionConfirmationAuthorization | null
}

export interface ContributionSummary {
  pendingCount: number
  confirmedCount: number
  disputeCount: number
  cancelledCount: number
  totalConfirmedAmount: number
  totalPendingAmount: number
  collectionScope: 'PERSONAL' | 'GLOBAL'
}
