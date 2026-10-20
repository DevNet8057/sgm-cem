// EF-M08-06 : un contributeur externe déjà connu (même téléphone) n'est pas écrasé.
import { describe, it, expect } from 'vitest'
import { getPrisma } from '../src/lib/prisma'
import { cleanDonorName, nextAliases, payerName, resolveExternalContributor } from '../src/services/contributeur-externe.service'

const prisma = getPrisma()
const stamp = String(Date.now()).slice(-7)
const phone = `+23765${stamp}`

describe('Contributeur externe', () => {
  it('alias : nouveau nom ajouté, nom déjà connu ignoré (casse, accents, espaces)', () => {
    expect(cleanDonorName('  Awa   Essomba ')).toBe('Awa Essomba')
    expect(nextAliases({ nom: 'Élise Mbarga', aliases: [] }, 'elise  MBARGA')).toBeNull()
    expect(nextAliases({ nom: 'Élise Mbarga', aliases: [] }, 'Paul Mbarga')).toEqual(['Paul Mbarga'])
    expect(nextAliases({ nom: 'Élise Mbarga', aliases: ['Paul Mbarga'] }, 'paul mbarga')).toBeNull()
  })

  it('second don avec le même téléphone : premier nom et e-mail conservés', async () => {
    const first = await resolveExternalContributor(prisma, { phone, nom: 'Élise Mbarga', email: 'elise@test.local', consentVersion: 'v1' })
    const second = await resolveExternalContributor(prisma, { phone, nom: 'Paul Mbarga', email: 'paul@test.local', consentVersion: 'v2' })
    expect(second.id).toBe(first.id)
    expect(second.nom).toBe('Élise Mbarga')
    expect(second.email).toBe('elise@test.local')
    expect(second.aliases).toEqual(['Paul Mbarga'])
    expect(second.consentVersion).toBe('v2')
    const third = await resolveExternalContributor(prisma, { phone, nom: 'paul  mbarga', consentVersion: 'v2' })
    expect(third.aliases).toEqual(['Paul Mbarga'])
  })

  it('e-mail complété seulement s\'il manquait', async () => {
    const p2 = `+23766${stamp}`
    await resolveExternalContributor(prisma, { phone: p2, nom: 'Sans Mail', consentVersion: 'v1' })
    const again = await resolveExternalContributor(prisma, { phone: p2, nom: 'Sans Mail', email: 'nouveau@test.local', consentVersion: 'v1' })
    expect(again.email).toBe('nouveau@test.local')
  })

  it('payeur affiché : membre, sinon nom saisi pour le don, sinon nom du contributeur', () => {
    expect(payerName({ membre: { user: { fullName: 'Membre A' } }, nomDonateur: 'X' })).toBe('Membre A')
    expect(payerName({ nomDonateur: 'Paul Mbarga', contributeurExterne: { nom: 'Élise Mbarga' } })).toBe('Paul Mbarga')
    expect(payerName({ nomDonateur: null, contributeurExterne: { nom: 'Élise Mbarga' } })).toBe('Élise Mbarga')
  })
})
