import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { syncYeliiContributionStatus, type SyncableContribution } from '../src/services/payment-status.service'

// On mocke `fetch` (réseau) plutôt que le module `yelii.service` : ce dernier
// est déjà mocké par `tests/public-collectes.test.ts` avec sa propre factory
// partielle. Le projet tourne en isolate:false/singleFork, donc un module
// n'est mocké qu'UNE seule fois pour tout le run — un second `vi.mock` sur le
// même module ici serait silencieusement ignoré. En mockant `fetch`, on
// laisse la vraie `getYeliiStatus` s'exécuter et on teste le vrai chemin
// d'intégration, sans dépendre de l'ordre d'exécution des fichiers.

// Aucun accès base de données dans ce fichier : tous les cas testés sont ceux
// où syncYeliiContributionStatus ne déclenche AUCUNE écriture Prisma.

function buildContribution(overrides: Partial<SyncableContribution>): SyncableContribution {
  return {
    id: 'contrib-1',
    statut: 'EN_ATTENTE_CONFIRMATION',
    paymentStatus: 'PROCESSING',
    modePaiement: 'MTN_MOMO',
    externalTransactionId: null,
    referencePaiement: null,
    receiptUrl: null,
    rubriqueId: 'rubrique-1',
    ...overrides,
  } as SyncableContribution
}

const cleApiOriginale = process.env.YELII_COLLECT_API_KEY

beforeAll(() => {
  // Sans clé API, getYeliiStatus renvoie 'unknown' immédiatement sans jamais
  // appeler fetch : indispensable pour que les assertions sur les appels réseau soient valides.
  process.env.YELII_COLLECT_API_KEY = 'test-key'
})

afterAll(() => {
  // isolate:false + singleFork : sans restauration, la clé de test fuiterait
  // sur tous les fichiers de tests suivants du même run.
  if (cleApiOriginale === undefined) delete process.env.YELII_COLLECT_API_KEY
  else process.env.YELII_COLLECT_API_KEY = cleApiOriginale
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('syncYeliiContributionStatus', () => {
  it('court-circuite sur un statut terminal sans appel réseau', async () => {
    const contribution = buildContribution({
      statut: 'CONFIRME',
      paymentStatus: 'SUCCESS',
      modePaiement: 'MTN_MOMO',
      externalTransactionId: 'tx-terminal',
      referencePaiement: 'REF-TERMINAL',
      receiptUrl: 'https://example.cm/recu-terminal.pdf',
    })

    const result = await syncYeliiContributionStatus(contribution)

    expect(fetch).not.toHaveBeenCalled()
    expect(result).toEqual({
      id: contribution.id,
      statut: contribution.statut,
      paymentStatus: contribution.paymentStatus,
      receiptUrl: contribution.receiptUrl,
    })
  })

  it('déduplique les appels en vol sur un même transactionId', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                status: 200,
                json: async () => ({ status: 'pending' }),
              }),
            50
          )
        )
    )

    const contribution = buildContribution({
      statut: 'EN_ATTENTE_CONFIRMATION',
      paymentStatus: 'PROCESSING',
      externalTransactionId: 'tx-dedupe',
    })

    await Promise.all([syncYeliiContributionStatus(contribution), syncYeliiContributionStatus(contribution)])

    // Un seul appel réseau malgré deux requêtes concurrentes (ex. deux onglets ouverts).
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("ne modifie rien quand Yelii est injoignable", async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'))

    const contribution = buildContribution({
      statut: 'EN_ATTENTE_CONFIRMATION',
      paymentStatus: 'PROCESSING',
      externalTransactionId: 'tx-unknown',
    })

    const result = await syncYeliiContributionStatus(contribution)

    // Garantie anti-faux-négatif : une indisponibilité de Yelii ne doit jamais
    // annuler un paiement valide — le statut d'entrée est conservé tel quel.
    expect(result).toEqual({
      id: contribution.id,
      statut: 'EN_ATTENTE_CONFIRMATION',
      paymentStatus: 'PROCESSING',
      receiptUrl: contribution.receiptUrl,
    })
  })
})
