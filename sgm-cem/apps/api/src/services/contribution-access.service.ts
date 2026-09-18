import type {
  ContributionActions,
  ContributionConfirmationAuthorization,
} from '@sgm-cem/shared'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { AppError } from '../middleware/errorHandler'

export type ContributionActor = {
  userId: string
  role: string
}

export type ContributionAccessRecord = {
  collecteurId: string | null
  statut: string
  modePaiement: string
  externalTransactionId?: string | null
  momoTransactionId?: string | null
  transferId?: string | null
  bankDepositId?: string | null
  localisationFonds?: string
  confirmationAuthorization?: unknown
}

const staffRoles = new Set([
  'COLLECTEUR',
  'ADJOINT_RESPONSABLE',
  'RESPONSABLE',
  'TRESORIER',
  'ADMIN',
  'DEVELOPER',
])

const supervisorRoles = new Set([
  'ADJOINT_RESPONSABLE',
  'RESPONSABLE',
  'TRESORIER',
  'ADMIN',
  'DEVELOPER',
])

const elevatedRoles = new Set(['ADMIN', 'DEVELOPER'])

const globalScopeRoles = new Set([
  'ADJOINT_RESPONSABLE',
  'RESPONSABLE',
  'TRESORIER',
  'ADMIN',
  'DEVELOPER',
])

export const confirmationAuthorizationSchema = z.object({
  treasurerId: z.string().min(1),
  grantedById: z.string().min(1),
  grantedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  motif: z.string().trim().min(10).max(500),
  consumedAt: z.string().datetime().optional(),
  revokedAt: z.string().datetime().optional(),
})

export function parseConfirmationAuthorization(
  recordValue: unknown,
): ContributionConfirmationAuthorization | null {
  const parsed = confirmationAuthorizationSchema.safeParse(recordValue)
  return parsed.success ? parsed.data : null
}

export function getContributionScope(
  actor: ContributionActor,
): Prisma.ContributionWhereInput {
  if (actor.role === 'COLLECTEUR') {
    return { collecteurId: actor.userId }
  }

  if (globalScopeRoles.has(actor.role)) {
    return {}
  }

  if (actor.role === 'MEMBRE') {
    return { membre: { userId: actor.userId } }
  }

  return { id: { in: [] } }
}

export function assertContributionReadable(
  actor: ContributionActor,
  record: ContributionAccessRecord,
): void {
  if (actor.role === 'COLLECTEUR' && record.collecteurId !== actor.userId) {
    throw new AppError('NOT_FOUND', 'Contribution introuvable', 404)
  }
}

export function isManualContribution(record: ContributionAccessRecord): boolean {
  return (
    (record.modePaiement === 'ESPECES' || record.modePaiement === 'VIREMENT') &&
    !record.externalTransactionId &&
    !record.momoTransactionId
  )
}

function hasValidAuthorization(
  actor: ContributionActor,
  record: ContributionAccessRecord,
  now: Date,
  authorizationActorsValid: boolean,
): boolean {
  const authorization = parseConfirmationAuthorization(record.confirmationAuthorization)
  if (!authorization || !authorizationActorsValid || actor.role !== 'TRESORIER') {
    return false
  }

  const grantedAt = new Date(authorization.grantedAt)
  const expiresAt = new Date(authorization.expiresAt)
  return (
    authorization.treasurerId === actor.userId &&
    grantedAt <= now &&
    now < expiresAt &&
    !authorization.consumedAt &&
    !authorization.revokedAt
  )
}

function canManageDisputeFunds(record: ContributionAccessRecord): boolean {
  return (
    !record.transferId &&
    !record.bankDepositId &&
    (!record.localisationFonds ||
      record.localisationFonds === 'CHEZ_COLLECTEUR' ||
      record.localisationFonds === 'EN_TRANSIT')
  )
}

export function getContributionActions(
  actor: ContributionActor,
  record: ContributionAccessRecord,
  now = new Date(),
  authorizationActorsValid = false,
): ContributionActions {
  const noActions: ContributionActions = {
    canConfirm: false,
    canRefuse: false,
    canDispute: false,
    canResolveDispute: false,
    canGrantConfirmation: false,
  }

  if (!staffRoles.has(actor.role)) {
    return noActions
  }

  const manual = isManualContribution(record)
  const own = record.collecteurId === actor.userId
  const elevated = elevatedRoles.has(actor.role)
  const supervisor = supervisorRoles.has(actor.role)
  const authorization = hasValidAuthorization(actor, record, now, authorizationActorsValid)
  const confirmationAllowed = own || elevated || authorization
  const pending = record.statut === 'EN_ATTENTE_CONFIRMATION'
  const disputed = record.statut === 'LITIGE'
  const disputeFundsManageable = canManageDisputeFunds(record)

  return {
    canConfirm:
      manual &&
      confirmationAllowed &&
      (pending || (disputed && supervisor)),
    canRefuse: manual && pending && confirmationAllowed,
    canDispute:
      supervisor &&
      (pending || record.statut === 'CONFIRME') &&
      disputeFundsManageable,
    canResolveDispute:
      supervisor && disputed && manual && disputeFundsManageable,
    canGrantConfirmation:
      elevated &&
      manual &&
      (pending || disputed) &&
      record.collecteurId !== null,
  }
}

export function assertContributionAction(
  actor: ContributionActor,
  record: ContributionAccessRecord,
  action: keyof ContributionActions,
  now = new Date(),
  authorizationActorsValid = false,
): void {
  assertContributionReadable(actor, record)

  if (!getContributionActions(actor, record, now, authorizationActorsValid)[action]) {
    throw new AppError('FORBIDDEN', 'Vous n’êtes pas autorisé à effectuer cette action.', 403)
  }
}
