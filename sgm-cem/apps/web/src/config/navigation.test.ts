import { describe, expect, it } from 'vitest'
import type { UserRole } from '@/types'
import {
  canAccessView,
  getMobileNavigationForRole,
  getNavigationForRole,
  type ViewId,
} from './navigation'

const roles: readonly UserRole[] = [
  'MEMBRE',
  'COLLECTEUR',
  'ADJOINT_RESPONSABLE',
  'RESPONSABLE',
  'TRESORIER',
  'ADMIN',
  'DEVELOPER',
]

const expectedViews: Record<UserRole, readonly ViewId[]> = {
  MEMBRE: ['mes-contributions', 'notifications', 'journal', 'mon-profil'],
  COLLECTEUR: [
    'dashboard',
    'rubriques',
    'contributions',
    'collecteurs',
    'validations',
    'transfer-validations',
    'notifications',
    'journal',
    'mon-profil',
  ],
  ADJOINT_RESPONSABLE: [
    'dashboard',
    'rubriques',
    'contributions',
    'collecteurs',
    'validations',
    'transfer-validations',
    'membres',
    'ged',
    'prestations',
    'litiges',
    'statistiques',
    'rapports',
    'notifications',
    'journal',
    'mon-profil',
  ],
  RESPONSABLE: [
    'dashboard',
    'rubriques',
    'contributions',
    'collecteurs',
    'validations',
    'transfer-validations',
    'membres',
    'ged',
    'prestations',
    'litiges',
    'statistiques',
    'rapports',
    'notifications',
    'journal',
    'mon-profil',
  ],
  TRESORIER: [
    'dashboard',
    'rubriques',
    'contributions',
    'collecteurs',
    'validations',
    'transfer-validations',
    'collectes-publiques',
    'membres',
    'ged',
    'prestations',
    'litiges',
    'statistiques',
    'rapports',
    'notifications',
    'journal',
    'mon-profil',
  ],
  ADMIN: [
    'dashboard',
    'rubriques',
    'contributions',
    'collecteurs',
    'validations',
    'transfer-validations',
    'collectes-publiques',
    'membres',
    'ged',
    'prestations',
    'litiges',
    'statistiques',
    'rapports',
    'notifications',
    'journal',
    'utilisateurs',
    'parametres',
    'mon-profil',
  ],
  DEVELOPER: [
    'dashboard',
    'rubriques',
    'contributions',
    'collecteurs',
    'validations',
    'transfer-validations',
    'collectes-publiques',
    'membres',
    'ged',
    'prestations',
    'litiges',
    'statistiques',
    'rapports',
    'notifications',
    'journal',
    'utilisateurs',
    'parametres',
    'developer',
    'mon-profil',
  ],
}

describe('navigation RBAC', () => {
  it.each(roles)('expose exactement les vues autorisées pour %s', role => {
    const views = getNavigationForRole(role).map(item => item.id)
    expect(views).toEqual(expectedViews[role])
    for (const view of expectedViews[role]) {
      expect(canAccessView(role, view)).toBe(true)
    }
  })

  it('réserve les écrans système aux rôles attendus', () => {
    expect(canAccessView('ADMIN', 'parametres')).toBe(true)
    expect(canAccessView('DEVELOPER', 'developer')).toBe(true)
    expect(canAccessView('ADMIN', 'developer')).toBe(false)
    expect(canAccessView('TRESORIER', 'parametres')).toBe(false)
    expect(canAccessView('MEMBRE', 'dashboard')).toBe(false)
  })

  it('laisse le collecteur réceptionner ses fonds sur desktop et mobile', () => {
    expect(canAccessView('COLLECTEUR', 'transfer-validations')).toBe(true)
    expect(getMobileNavigationForRole('COLLECTEUR').map(item => item.id))
      .toContain('transfer-validations')
  })
})

describe('navigation mobile', () => {
  it.each(roles)('reste autorisée, ordonnée et limitée à cinq entrées pour %s', role => {
    const items = getMobileNavigationForRole(role)
    expect(items.length).toBeLessThanOrEqual(5)
    expect(items.every(item => canAccessView(role, item.id))).toBe(true)
    expect(items.map(item => item.mobile?.order)).toEqual(
      [...items].map(item => item.mobile?.order).sort((left, right) => (left ?? 0) - (right ?? 0))
    )
  })
})
