# FLOW DE PAIEMENT MOBILE MONEY — SGM-CEM
## Intégration Yelii Pro Pay (Orange Money + MTN MoMo)
## Document de Référence Officiel · Culte d'Enfants de Melen

---

## AVANT DE COMMENCER

Ce document décrit **UN SEUL** mode de paiement : le **Mobile Money via Yelii Pro Pay** (qui couvre Orange Money ET MTN MoMo avec une seule API).

Ce document remplace tout ancien flow de paiement Mobile Money dans le projet. Le développeur doit :
1. Lire `CLAUDE.md` (design system, règles métier RB-01 à RB-29)
2. Lire ce fichier intégralement
3. Supprimer tout ancien code de paiement MTN/Orange qui n'utilise pas Yelii
4. Suivre exactement les 4 étapes du cycle de vie décrites ici
5. Mettre à jour `PROGRESS_SGM_CEM.md` après chaque étape vérifiée

**Le paiement par espèces existe déjà** dans le projet (double validation collecteur) — ne pas y toucher, il est juste rappelé en fin de document pour cohérence.

**Règle absolue (RB-02) : un paiement Mobile Money n'est CONFIRMÉ dans la base de données qu'après réception ET vérification du webhook Yelii. Jamais avant.**

---

## 1. IDENTIFIANTS ET CONFIGURATION

### Clé API et URL de base

```
Clé API Collecte : yelii_pay_2c2c433eba426481a0003b1d4f7211f3
URL de base      : https://api.yelii.xyz/api/yelii-pro-pay/v1
Documentation    : https://www.digiii.xyz/yelii-pro-pay-api-doc.html
Commission Yelii : 2,5% par transaction
```

### En-tête d'authentification — POINT CRITIQUE

Chaque requête vers Yelii doit inclure cet en-tête EXACT :

```
X-Collect-Api-Key: yelii_pay_2c2c433eba426481a0003b1d4f7211f3
```

⚠️ **L'en-tête s'appelle `X-Collect-Api-Key`** (avec des tirets). Ne pas confondre avec `X-COLLECT-API-KEY` en majuscules (la casse de l'en-tête est généralement tolérée par HTTP, mais utiliser la forme documentée `X-Collect-Api-Key` pour éviter tout problème).

### Variables d'environnement

À placer dans `apps/api/.env` (jamais committer la vraie clé) :

```bash
YELII_API_KEY="yelii_pay_2c2c433eba426481a0003b1d4f7211f3"
YELII_BASE_URL="https://api.yelii.xyz/api/yelii-pro-pay/v1"
YELII_WEBHOOK_SECRET=""
# En développement local (ngrok) :
YELII_WEBHOOK_URL="https://[ton-id].ngrok.io/webhooks/yelii"
# En production :
# YELII_WEBHOOK_URL="https://api.sgm-cem.cm/webhooks/yelii"
```

**Note importante sur la clé** : la documentation Yelii mentionne deux noms de variable selon les pages (`YELII_COLLECT_API_KEY` dans un exemple, `YELII_API_KEY` dans le tableau de bord). Utiliser **`YELII_API_KEY`** comme nom de variable dans le projet (c'est le nom du dashboard), et bien vérifier que sa valeur est utilisée à la fois pour l'en-tête `X-Collect-Api-Key` ET pour la vérification de la signature HMAC du webhook — **c'est la même clé pour les deux usages**.

---

## 1bis. RÈGLE MÉTIER CRITIQUE — QUI PAIE LA COMMISSION DE 2,5% ?

**C'est le contributeur (l'utilisateur qui paie) qui supporte les 2,5% de commission Yelii, pas l'organisation.**

Ça veut dire concrètement : si une rubrique demande 5 000 FCFA, le membre ne doit PAS payer seulement 5 000 FCFA en pensant que SGM-CEM recevra 4 875 FCFA après commission. **Le membre doit payer 5 000 FCFA + la commission, pour que SGM-CEM reçoive exactement 5 000 FCFA nets.**

### Où ce calcul doit se faire — AVANT l'appel à Yelii, jamais après

Le calcul se fait **au moment où le montant est déterminé dans l'interface**, avant l'étape d'initiation. Ce n'est jamais Yelii qui ajoute la commission — c'est **SGM-CEM qui majore le montant envoyé à Yelii**, pour compenser la commission qui sera déduite automatiquement de l'autre côté.

### La formule exacte

Yelii prélève 2,5% du montant qu'on lui envoie et crédite le reste (`netCredited`). Pour que le montant net crédité corresponde exactement au montant dû à la rubrique, il faut envoyer un montant majoré :

```
montant_dû_rubrique = ce que le membre doit réellement pour la rubrique (ex: 5 000 FCFA)
taux_commission     = 2.5% = 0.025

montant_a_envoyer_a_yelii = montant_dû_rubrique / (1 - taux_commission)
                           = montant_dû_rubrique / 0.975

Exemple concret :
  montant_dû_rubrique       = 5 000 FCFA
  montant_a_envoyer_a_yelii = 5 000 / 0.975 = 5 128,205... FCFA
  → arrondi à 5 129 FCFA (toujours arrondir AU-DESSUS, jamais en dessous,
    pour garantir que la rubrique reçoit au moins le montant dû)

Vérification :
  commission Yelii sur 5 129 FCFA = 5 129 × 0.025 = 128,225 FCFA
  netCredited = 5 129 - 128,225 = 5 000,775 FCFA ≈ 5 001 FCFA
  → la rubrique reçoit bien au moins les 5 000 FCFA dus, jamais moins
```

**Pourquoi diviser par `(1 - 0.025)` et non pas juste multiplier par `1.025`** : multiplier par 1,025 donnerait 5 125 FCFA, et la commission de 2,5% sur 5 125 FCFA serait 128,125 FCFA, laissant un net crédité de 4 996,875 FCFA — **en dessous** des 5 000 FCFA dus. La division par `(1 - taux)` est la formule mathématiquement correcte pour garantir que le net crédité couvre bien le montant dû. Toujours arrondir le résultat final à l'entier supérieur (`Math.ceil`) pour ne jamais léser l'organisation d'un centime.

### Ce que voit le membre dans l'interface — transparence obligatoire

L'utilisateur doit voir clairement qu'il paie un montant majoré et pourquoi. Ne jamais lui montrer un montant différent de celui qu'il va réellement débiter sur son Mobile Money, et ne jamais cacher la commission.

```
┌─────────────────────────────────────────────────────┐
│  Montant de la contribution                          │
│  ┌──────────────────────────────────────────────┐   │
│  │ 5 000 FCFA                                   │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │ Détail du paiement Mobile Money               │   │
│  │                                              │   │
│  │  Montant de la contribution      5 000 FCFA  │   │
│  │  Frais de transaction (2,5%)       129 FCFA  │   │
│  │  ─────────────────────────────────────────── │   │
│  │  Total à payer                   5 129 FCFA  │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ℹ Les frais de transaction Mobile Money sont à     │
│    la charge du contributeur, conformément à la     │
│    politique de l'organisation.                     │
│                                                     │
│  [← Retour]                    [Confirmer & Payer] │
└─────────────────────────────────────────────────────┘
```

### Où implémenter cette logique dans le code

**Côté frontend**, au moment d'afficher le récapitulatif (étape 3 du stepper, avant l'appel API) :

```typescript
// apps/web/src/lib/payment-calculations.ts

const YELII_COMMISSION_RATE = 0.025  // 2,5% — garder synchronisé avec le taux réel Yelii

/**
 * Calcule le montant à envoyer à Yelii pour que le montant NET crédité
 * corresponde exactement au montant dû par le contributeur.
 * Le contributeur supporte la commission, pas l'organisation.
 */
export function calculateAmountWithCommission(dueAmount: number): {
  dueAmount: number
  commissionAmount: number
  totalToPay: number
} {
  const totalToPay = Math.ceil(dueAmount / (1 - YELII_COMMISSION_RATE))
  const commissionAmount = totalToPay - dueAmount
  return { dueAmount, commissionAmount, totalToPay }
}

// Exemple d'utilisation dans le composant du récapitulatif :
// const { dueAmount, commissionAmount, totalToPay } = calculateAmountWithCommission(contribution.amount)
// → afficher dueAmount, commissionAmount et totalToPay comme dans la maquette ci-dessus
// → c'est totalToPay qui est envoyé au backend, PAS dueAmount
```

**Côté backend**, la route d'initiation (section 6) doit recevoir et envoyer à Yelii ce `totalToPay`, jamais le montant dû brut :

```typescript
// Dans POST /api/payments/mobile/initiate — modification de la logique existante

// NE PAS envoyer contribution.amount tel quel à Yelii.
// Calculer le montant majoré AVANT l'appel à initiateCollection().

import { calculateAmountWithCommission } from '../lib/payment-calculations'
// (créer l'équivalent backend de cette fonction, ou la partager via un package commun
//  si le monorepo a un dossier packages/shared — vérifier CLAUDE.md pour la structure exacte)

const { totalToPay, commissionAmount } = calculateAmountWithCommission(contribution.amount)

const yelii = await initiateCollection({
  amount: totalToPay,        // ← montant MAJORÉ envoyé à Yelii, pas contribution.amount
  senderPhone: phone,
  channel,
})

// Stocker les deux montants pour la traçabilité et le reçu
await prisma.contribution.update({
  where: { id: contributionId },
  data: {
    externalTransactionId: yelii.data.transactionId,
    paymentStatus: 'PROCESSING',
    paymentMethod: channel === 'orange_money' ? 'ORANGE_MONEY' : 'MTN_MOMO',
    amountChargedToPayer: totalToPay,      // nouveau champ — voir schéma Prisma section 11
    commissionPaidByPayer: commissionAmount, // nouveau champ
  },
})
```

**Règle de cohérence critique** : la fonction de calcul (`calculateAmountWithCommission`) doit exister en un seul endroit partagé entre frontend et backend (idéalement dans `packages/shared` si le monorepo en a un — vérifier la structure dans `CLAUDE.md`), pour que le montant affiché au membre soit **exactement** celui envoyé à Yelii. Si la logique est dupliquée dans deux fichiers séparés et qu'un seul est mis à jour un jour (ex: si le taux Yelii change), le montant affiché et le montant réellement débité pourraient diverger — ce qui serait un bug financier grave et une perte de confiance des membres.

### Vérification lors de la réception du webhook

Dans le webhook (section 7), le montant reçu de Yelii (`payload.data.amount`) sera le montant majoré (`totalToPay`), pas le montant dû initial. Le `netCredited` renvoyé par Yelii doit être proche du montant dû (`dueAmount`), avec un léger surplus dû à l'arrondi supérieur — c'est normal et attendu, ce surplus reste acquis à l'organisation plutôt que de risquer un manque.

Le reçu PDF généré (section B7 / receipt.service.ts) doit afficher le montant dû à la rubrique (`contribution.amount`), pas le montant majoré payé sur le téléphone — c'est le montant qui compte pour la comptabilité de la rubrique et l'historique du membre. Le détail des frais de transaction peut apparaître en mention secondaire sur le reçu si souhaité, mais le montant principal du reçu doit rester le montant dû, cohérent avec ce que voit le trésorier dans les statistiques de la rubrique.

---

La doc Yelii expose exactement ces endpoints. On en utilise 3 (plus le retry en cas de besoin).

```
POST /collect/initiate              → Initier une collecte Mobile Money
GET  /collect/status/:transactionId → Récupérer le statut d'une collecte
GET  /wallet/balance                → Consulter le solde du wallet collecte
POST /collect/callback/retry/:id    → Rejouer le webhook (si serveur était down)
```

---

## 3. LE CYCLE DE VIE EN 4 ÉTAPES (selon la doc Yelii)

La documentation Yelii définit précisément 4 étapes. On les suit exactement.

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ 1. INITIATION│──>│ 2. VALIDATION│──>│3. NOTIFICATION│──>│4. CONFIRMATION│
│              │   │              │   │              │   │              │
│ POST         │   │ Client valide│   │ Webhook      │   │ GET          │
│ /collect/    │   │ sur son      │   │ envoyé à     │   │ /collect/    │
│ initiate     │   │ téléphone    │   │ callbackUrl  │   │ status/:id   │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘

Statut initial : "processing"
Statut final   : "success" ou "failed"
```

**Comment connaître le résultat final :** deux méthodes complémentaires.
- **Méthode principale (recommandée par Yelii)** : le webhook. Yelii appelle ton serveur automatiquement.
- **Méthode de secours (fallback)** : le polling sur `/collect/status/:id` si le webhook n'arrive pas.

On implémente les DEUX pour la robustesse.

---

## 4. FLOW COMPLET CÔTÉ UTILISATEUR

### Étape utilisateur 1 — Choix du Mobile Money

L'utilisateur est sur le stepper de paiement. Il choisit "Mobile Money" et précise l'opérateur :

```
┌─────────────────────────────────────────────────────┐
│  Comment souhaitez-vous payer ?                      │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │      🟠      │  │      🟡      │                 │
│  │ Orange Money │  │  MTN MoMo   │                 │
│  └──────────────┘  └──────────────┘                 │
│                                                     │
│  Numéro Mobile Money                                │
│  ┌──────────────────────────────────────────────┐   │
│  │ +237  │  6 90 12 34 56                       │   │
│  └──────────────────────────────────────────────┘   │
│  Format : 6XXXXXXXX (l'indicatif +237 est          │
│  nettoyé automatiquement par Yelii)                 │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │ Montant de la contribution      5 000 FCFA   │   │
│  │ Frais de transaction (2,5%)       129 FCFA   │   │
│  │ ────────────────────────────────────────────│   │
│  │ Total à payer                   5 129 FCFA   │   │
│  └──────────────────────────────────────────────┘   │
│  ℹ Les frais Mobile Money sont à votre charge.      │
│                                                     │
│  [← Retour]                    [Confirmer & Payer] │
└─────────────────────────────────────────────────────┘
```

Le champ `channel` envoyé à Yelii dépend du choix :
- Orange Money → `channel: "orange_money"`
- MTN MoMo → `channel: "mtn_money"`

**Rappel : le montant envoyé à Yelii est `5 129 FCFA` (le total majoré), pas `5 000 FCFA`. Voir section 1bis pour le calcul exact.**

### Étape utilisateur 2 — Écran d'attente USSD

Dès que l'utilisateur clique "Confirmer & Payer", ton serveur appelle Yelii, et l'écran passe en mode attente :

```
┌─────────────────────────────────────────────────────┐
│              ⟳  Paiement en cours...               │
│                                                     │
│  Une demande vient d'être envoyée sur votre          │
│  téléphone Orange Money                             │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  1. Vérifiez votre téléphone                 │   │
│  │  2. Entrez votre code PIN Mobile Money       │   │
│  │  3. Validez le paiement de 5 000 FCFA        │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ⏱  Cet écran se mettra à jour automatiquement     │
│                                                     │
│  [Annuler]                                          │
└─────────────────────────────────────────────────────┘
```

### Étape utilisateur 3 — Résultat

Quand le webhook confirme (ou le polling détecte le statut final), l'écran affiche le résultat :

```
SUCCÈS :
┌─────────────────────────────────────────────────────┐
│                    ✅ Paiement réussi !              │
│  Brigitte FOUDA · CA-DEUIL · 5 000 FCFA           │
│  Orange Money · 16 juin 2026 à 14h32              │
│  Réf : CEM-2026-000042                             │
│                                                     │
│  [📥 Télécharger le reçu]  [↗ Partager]            │
└─────────────────────────────────────────────────────┘

ÉCHEC :
┌─────────────────────────────────────────────────────┐
│                    ❌ Paiement échoué               │
│  Le paiement n'a pas abouti (PIN incorrect,         │
│  solde insuffisant, ou délai expiré).               │
│                                                     │
│  [Réessayer]   [Payer en espèces à un collecteur]  │
└─────────────────────────────────────────────────────┘
```

---

## 5. IMPLÉMENTATION — SERVICE YELII

Créer `apps/api/src/services/yelii.service.ts` :

```typescript
import crypto from 'crypto'

const BASE_URL = process.env.YELII_BASE_URL!    // https://api.yelii.xyz/api/yelii-pro-pay/v1
const API_KEY  = process.env.YELII_API_KEY!     // yelii_pay_...

// ── Types ────────────────────────────────────────────────────────────────
export type YeliiChannel = 'orange_money' | 'mtn_money'
export type YeliiStatus  = 'processing' | 'success' | 'failed'

interface InitiateParams {
  amount: number         // FCFA, entier > 0
  senderPhone: string    // 6XXXXXXXX ou +2376XXXXXXXX
  channel: YeliiChannel
}

interface InitiateResponse {
  success: boolean
  message: string
  data: {
    transactionId: string
    externalId: string
    partnerReference: string
    yeliiReference: string
    status: 'processing'
    amount: number
    channel: string
  }
}

interface StatusResponse {
  success: boolean
  data: {
    transactionId: string
    status: YeliiStatus
    amount: number
    commissionRate?: number
    commissionAmount?: number
    netCredited?: number
    channel: string
    createdAt?: string
    completedAt?: string
  }
}

// ── 1. INITIER UNE COLLECTE ──────────────────────────────────────────────
/**
 * Étape 1 du cycle de vie Yelii.
 * Envoie une demande de paiement. Le client reçoit une notification USSD.
 * Retourne immédiatement un transactionId (statut "processing").
 * Le résultat final arrive par webhook (étape 3) ou polling (étape 4).
 */
export async function initiateCollection(params: InitiateParams): Promise<InitiateResponse> {
  const res = await fetch(`${BASE_URL}/collect/initiate`, {
    method: 'POST',
    headers: {
      'X-Collect-Api-Key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: params.amount,
      senderPhone: params.senderPhone,
      channel: params.channel,
      callbackUrl: process.env.YELII_WEBHOOK_URL,
    }),
  })

  const data = await res.json()

  if (!data.success) {
    // Yelii renvoie success:false avec un message en cas d'échec opérateur
    const err = new Error(data.message || 'Collecte échouée')
    ;(err as any).status = res.status
    throw err
  }

  return data
}

// ── 2. CONSULTER LE STATUT (polling / fallback) ──────────────────────────
/**
 * Étape 4 du cycle de vie Yelii.
 * À utiliser en fallback si le webhook n'est pas reçu,
 * ou pour confirmer le résultat final.
 */
export async function getCollectionStatus(transactionId: string): Promise<StatusResponse> {
  const res = await fetch(`${BASE_URL}/collect/status/${transactionId}`, {
    headers: { 'X-Collect-Api-Key': API_KEY },
  })
  const data = await res.json()
  if (!data.success) {
    const err = new Error(data.message || 'Statut introuvable')
    ;(err as any).status = res.status
    throw err
  }
  return data
}

// ── 3. SOLDE DU WALLET ───────────────────────────────────────────────────
export async function getWalletBalance() {
  const res = await fetch(`${BASE_URL}/wallet/balance`, {
    headers: { 'X-Collect-Api-Key': API_KEY },
  })
  return res.json()
}

// ── 4. REJOUER LE WEBHOOK ────────────────────────────────────────────────
/**
 * Force Yelii à renvoyer le webhook pour une transaction.
 * Utile si ton serveur était indisponible lors de la notification initiale.
 */
export async function retryWebhook(transactionId: string) {
  const res = await fetch(`${BASE_URL}/collect/callback/retry/${transactionId}`, {
    method: 'POST',
    headers: { 'X-Collect-Api-Key': API_KEY },
  })
  return res.json()
}

// ── VÉRIFICATION DE SIGNATURE WEBHOOK ────────────────────────────────────
/**
 * Vérifie qu'un webhook entrant vient vraiment de Yelii.
 * Signature attendue : HMAC_SHA512(collectApiKey, timestamp + rawBody)
 *
 * IMPORTANT : rawBody doit être le corps HTTP EXACT reçu, non parsé/reformaté.
 * Si tu parses le JSON puis le re-stringifies, la signature ne correspondra plus.
 */
export function verifyWebhookSignature(
  timestamp: string | undefined,
  signature: string | undefined,
  rawBody: string
): boolean {
  if (!timestamp || !signature) return false

  // Rejette les webhooks de plus de 5 minutes (anti-replay)
  if (Math.abs(Date.now() - Number(timestamp)) > 300_000) return false

  const expected = crypto
    .createHmac('sha512', API_KEY)
    .update(timestamp + rawBody)
    .digest('hex')

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    )
  } catch {
    return false
  }
}
```

---

## 6. IMPLÉMENTATION — ROUTE D'INITIATION (frontend → API)

Créer/compléter `apps/api/src/routes/payments.ts` :

```typescript
import { Router } from 'express'
import { initiateCollection, getCollectionStatus } from '../services/yelii.service'
import { authenticate } from '../middleware/auth'
import { prisma } from '../lib/prisma'

const router = Router()

/**
 * POST /api/payments/mobile/initiate
 * Body : { contributionId, phone, channel }
 * channel = 'orange_money' | 'mtn_money'
 */
router.post('/mobile/initiate', authenticate, async (req, res) => {
  try {
    const { contributionId, phone, channel } = req.body

    // Validation basique
    if (!contributionId || !phone || !channel) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PARAMS', message: 'Paramètres manquants' }
      })
    }

    // Récupérer la contribution
    const contribution = await prisma.contribution.findUnique({
      where: { id: contributionId },
    })
    if (!contribution) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Contribution introuvable' }
      })
    }

    // Anti double-clic : si un paiement est déjà en cours, renvoyer l'existant
    if (contribution.paymentStatus === 'PROCESSING' && contribution.externalTransactionId) {
      return res.json({
        success: true,
        data: { transactionId: contribution.externalTransactionId, status: 'processing' }
      })
    }

    // Appeler Yelii
    const yelii = await initiateCollection({
      amount: contribution.amount,
      senderPhone: phone,
      channel,
    })

    // Stocker le transactionId + passer en PROCESSING
    await prisma.contribution.update({
      where: { id: contributionId },
      data: {
        externalTransactionId: yelii.data.transactionId,
        paymentStatus: 'PROCESSING',
        paymentMethod: channel === 'orange_money' ? 'ORANGE_MONEY' : 'MTN_MOMO',
      },
    })

    return res.json({
      success: true,
      message: 'Paiement initié. Validez sur votre téléphone.',
      data: {
        transactionId: yelii.data.transactionId,
        status: 'processing',
      },
    })
  } catch (err: any) {
    // Gestion des erreurs Yelii (voir section codes d'erreur)
    return res.status(err.status || 500).json({
      success: false,
      error: { code: 'YELII_ERROR', message: err.message },
    })
  }
})

/**
 * GET /api/payments/mobile/status/:transactionId
 * Utilisé par le frontend en polling pendant l'écran d'attente.
 * Renvoie le statut de la contribution en base (mis à jour par le webhook).
 */
router.get('/mobile/status/:transactionId', authenticate, async (req, res) => {
  const { transactionId } = req.params

  const contribution = await prisma.contribution.findFirst({
    where: { externalTransactionId: transactionId },
    select: { id: true, status: true, paymentStatus: true, receiptUrl: true },
  })

  if (!contribution) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } })
  }

  // Fallback : si toujours en PROCESSING depuis longtemps, interroger Yelii directement
  if (contribution.paymentStatus === 'PROCESSING') {
    try {
      const yelii = await getCollectionStatus(transactionId)
      // Le webhook mettra à jour la base ; ici on renvoie juste l'info Yelii en direct
      return res.json({
        success: true,
        data: { status: yelii.data.status, paymentStatus: contribution.paymentStatus },
      })
    } catch {
      // Si Yelii ne répond pas, renvoyer l'état en base
    }
  }

  return res.json({
    success: true,
    data: {
      status: contribution.status,
      paymentStatus: contribution.paymentStatus,
      receiptUrl: contribution.receiptUrl,
    },
  })
})

export default router
```

---

## 7. IMPLÉMENTATION — WEBHOOK YELII (le cœur)

Créer `apps/api/src/webhooks/yelii.webhook.ts` :

```typescript
import express, { Router } from 'express'
import { verifyWebhookSignature } from '../services/yelii.service'
import { prisma } from '../lib/prisma'
import { generateReceiptPDF } from '../services/receipt.service'
import { sendWhatsApp } from '../services/notification.service'

const router = Router()

/**
 * POST /webhooks/yelii
 *
 * ⚠️ Cette route DOIT être enregistrée AVANT express.json() dans index.ts,
 * car la vérification de signature a besoin du body BRUT (non parsé).
 *
 * Dans apps/api/src/index.ts :
 *   app.use('/webhooks', yeliiWebhookRouter)   ← AVANT express.json()
 *   app.use(express.json())
 *   app.use('/api', mainRouter)
 */
router.post(
  '/yelii',
  express.raw({ type: '*/*' }),   // récupère le body brut en Buffer
  async (req, res) => {
    const rawBody = req.body.toString('utf8')
    const timestamp = req.headers['x-yelii-timestamp'] as string | undefined
    const signature = req.headers['x-yelii-signature'] as string | undefined

    // 1. Vérifier la signature — TOUJOURS EN PREMIER
    if (!verifyWebhookSignature(timestamp, signature, rawBody)) {
      console.error('[Yelii Webhook] Signature invalide — rejeté')
      return res.status(401).json({ error: 'Signature invalide' })
    }

    // 2. Répondre 200 IMMÉDIATEMENT (Yelii attend une réponse rapide)
    res.json({ received: true })

    // 3. Traiter en arrière-plan (après avoir répondu)
    let payload: any
    try {
      payload = JSON.parse(rawBody)
    } catch {
      console.error('[Yelii Webhook] Body JSON invalide')
      return
    }
    setImmediate(() => processWebhook(payload))
  }
)

async function processWebhook(payload: {
  event: string
  data: {
    transactionId: string
    status: 'processing' | 'success' | 'failed'
    amount: number
    commissionAmount?: number
    netCredited?: number
    channel: string
    senderPhone: string
  }
}) {
  if (payload.event !== 'collect.transaction.updated') return

  const { transactionId, status } = payload.data

  // Retrouver la contribution
  const contribution = await prisma.contribution.findFirst({
    where: { externalTransactionId: transactionId },
    include: { payer: true, rubrique: true },
  })
  if (!contribution) {
    console.warn(`[Yelii] Transaction ${transactionId} inconnue en base`)
    return
  }

  // IDEMPOTENCE (règle RB-12) : déjà traitée → ignorer
  if (contribution.status === 'CONFIRME' || contribution.status === 'ANNULE') {
    console.info(`[Yelii] ${transactionId} déjà traitée — ignorée`)
    return
  }

  // Le statut "processing" ne fait rien (paiement pas encore fini)
  if (status === 'processing') return

  if (status === 'success') {
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: {
        status: 'CONFIRME',
        paymentStatus: 'SUCCESS',
        confirmedAt: new Date(),         // horodatage SERVEUR (règle RB-01)
        netAmount: payload.data.netCredited,
      },
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'PAYMENT_CONFIRMED_YELII',
        entity: 'Contribution',
        entityId: contribution.id,
        after: JSON.stringify({ status: 'CONFIRME', transactionId }),
      },
    })

    // Reçu PDF + WhatsApp
    const receiptUrl = await generateReceiptPDF(contribution)
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: { receiptUrl },
    })
    await sendWhatsApp({
      phone: contribution.payer.phoneOrange || contribution.payer.phoneMtn!,
      template: 'cem_payment_confirmed',
      params: {
        name: contribution.payer.fullName,
        amount: `${payload.data.amount.toLocaleString('fr-FR')} FCFA`,
        rubrique: contribution.rubrique.title,
        receiptUrl,
      },
    })

    console.info(`[Yelii] ✅ Paiement confirmé — ${transactionId}`)

  } else if (status === 'failed') {
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: { status: 'ANNULE', paymentStatus: 'FAILED' },
    })
    await sendWhatsApp({
      phone: contribution.payer.phoneOrange || contribution.payer.phoneMtn!,
      template: 'cem_payment_failed',
      params: {
        name: contribution.payer.fullName,
        amount: `${payload.data.amount.toLocaleString('fr-FR')} FCFA`,
        rubrique: contribution.rubrique.title,
      },
    })
    console.info(`[Yelii] ❌ Paiement échoué — ${transactionId}`)
  }
}

export default router
```

---

## 8. ENREGISTREMENT DANS EXPRESS — ORDRE CRITIQUE

Dans `apps/api/src/index.ts`, l'ordre des middlewares est CRUCIAL :

```typescript
import yeliiWebhookRouter from './webhooks/yelii.webhook'
import paymentsRouter from './routes/payments'

// ... helmet, cors, etc. ...

// 1. Le webhook AVANT express.json() — il a besoin du body brut
app.use('/webhooks', yeliiWebhookRouter)

// 2. Ensuite seulement le parser JSON pour le reste
app.use(express.json())

// 3. Les autres routes
app.use('/api/payments', paymentsRouter)
app.use('/api', mainRouter)
```

**Pourquoi cet ordre :** si `express.json()` s'exécute avant le webhook, il parse le body et le reformate. La signature HMAC, qui est calculée sur le texte brut exact, ne correspondrait alors plus, et tous les webhooks seraient rejetés à tort.

---

## 9. GESTION DES CODES D'ERREUR YELII

La doc Yelii définit ces codes. Les gérer explicitement pour afficher le bon message à l'utilisateur.

| Code | Cause | Message utilisateur à afficher |
|---|---|---|
| 401 | Clé API invalide ou révoquée | "Erreur de configuration. Contactez l'administrateur." (log serveur, ne pas exposer) |
| 402 | Solde insuffisant pour l'opération | "Votre solde Mobile Money est insuffisant." |
| 409 | Référence déjà utilisée (doublon) | "Ce paiement a déjà été initié." (renvoyer le transactionId existant) |
| 422 | Numéro ou opérateur invalide | "Numéro ou opérateur invalide. Vérifiez votre numéro." |
| 400 | Paramètres manquants / montant invalide / canal non supporté | "Données de paiement invalides." |
| 400 | Collecte indisponible (opérateur a rejeté) | "Service Mobile Money momentanément indisponible. Réessayez." |
| 404 | Transaction introuvable | "Transaction introuvable." |
| 500 | Erreur serveur Yelii | "Erreur temporaire. Réessayez dans un instant." |

Exemple de gestion dans la route :

```typescript
catch (err: any) {
  const messages: Record<number, string> = {
    401: 'Erreur de configuration du paiement. Contactez l\'administrateur.',
    402: 'Solde Mobile Money insuffisant.',
    409: 'Ce paiement a déjà été initié.',
    422: 'Numéro ou opérateur invalide. Vérifiez votre numéro.',
    400: 'Données de paiement invalides ou service indisponible.',
    404: 'Transaction introuvable.',
    500: 'Erreur temporaire. Réessayez dans un instant.',
  }
  return res.status(err.status || 500).json({
    success: false,
    error: { code: 'YELII_ERROR', message: messages[err.status] || 'Erreur de paiement.' },
  })
}
```

---

## 10. LES 4 CAS LIMITES À GÉRER

### Cas 1 — Le webhook n'arrive jamais (serveur down au mauvais moment)

Yelii offre un endpoint de retry ET tu as le polling. Deux filets de sécurité :

**Filet A — Job de réconciliation automatique** (`apps/api/src/jobs/yelii-reconciliation.ts`) :
```typescript
// Toutes les 10 minutes, vérifier les contributions en PROCESSING depuis > 15 min
// Pour chacune, appeler getCollectionStatus() directement chez Yelii
// Si success → confirmer comme le ferait le webhook
// Si failed → passer en ANNULE
```

**Filet B — Bouton admin "Rejouer le webhook"** qui appelle `retryWebhook(transactionId)`.

### Cas 2 — Double webhook (Yelii renvoie deux fois)

Déjà géré par l'idempotence dans le handler (section 7) : si la contribution est déjà `CONFIRME`, on ignore. **Ne jamais retirer cette vérification.**

### Cas 3 — Double-clic sur "Payer"

Déjà géré dans la route (section 6) : si un paiement est déjà `PROCESSING`, on renvoie le `transactionId` existant au lieu d'en créer un nouveau.

### Cas 4 — L'utilisateur ferme l'onglet pendant le paiement

Le webhook confirme quand même la contribution en arrière-plan. Quand l'utilisateur revient, la liste de ses contributions affiche le bon statut. Le reçu et le WhatsApp partent normalement.

---

## 11. MISE À JOUR DU SCHÉMA PRISMA

Ajouter ces champs au modèle `Contribution` (vérifier s'ils existent déjà avant) :

```prisma
model Contribution {
  // ... champs existants ...

  externalTransactionId String?        @unique   // transactionId Yelii
  paymentStatus         PaymentStatus? @default(PENDING)
  netAmount             Int?                     // montant net reçu selon Yelii (proche de amount dû)
  confirmedAt           DateTime?                // horodatage serveur uniquement

  // Commission payée par le contributeur — règle métier section 1bis
  amountChargedToPayer  Int?                     // montant réellement débité (dû + commission)
  commissionPaidByPayer Int?                     // = amountChargedToPayer - amount

  @@index([externalTransactionId])
  @@index([paymentStatus])
}

enum PaymentStatus {
  PENDING       // créée, paiement pas encore initié
  PROCESSING    // demande envoyée à Yelii, en attente validation client
  SUCCESS       // webhook confirmé
  FAILED        // refusé/expiré
  CANCELLED     // annulé avant confirmation
}
```

Puis :
```bash
npx prisma migrate dev --name "add_yelii_payment_fields"
npx prisma generate
```

---

## 12. TESTS

### Tester les webhooks en local avec ngrok

Ton serveur local (`localhost:3001`) n'est pas accessible depuis internet. Yelii ne peut donc pas t'envoyer de webhook. Ngrok crée un tunnel public :

```bash
npm install -g ngrok
ngrok http 3001
# → te donne : https://abc123.ngrok.io

# Mettre cette URL dans .env :
YELII_WEBHOOK_URL="https://abc123.ngrok.io/webhooks/yelii"
```

⚠️ Cette URL change à chaque redémarrage de ngrok. La configurer aussi dans le dashboard Yelii si un webhook global y est défini.

### Checklist "go live" (issue de la doc Yelii)

- [ ] URL webhook configurée en HTTPS (pas HTTP)
- [ ] Vérification de la signature HMAC en place et testée
- [ ] Tests d'intégration effectués (sandbox si disponible)
- [ ] Gestion des retries et de l'idempotence en place

---

## 13. RAPPEL — LE FLOW ESPÈCES (existe déjà, ne pas toucher)

Pour mémoire, le paiement en espèces suit un flow différent, DÉJÀ implémenté dans le projet (double validation) :

```
Cas 1 : Le collecteur encaisse directement → contribution CONFIRME immédiat + reçu
Cas 2 : Le membre déclare avoir remis → collecteur confirme ou conteste
         Si confirme → CONFIRME + reçu
         Si conteste → LITIGE + alerte Trésorier
```

Ce flow n'utilise PAS Yelii (pas de webhook, pas d'appel API externe). Ne pas le modifier lors de l'intégration Yelii.

---

## 14. ORDRE D'IMPLÉMENTATION

Cocher chaque étape dans `PROGRESS_SGM_CEM.md` avant de passer à la suivante.

```
1. Supprimer tout ancien code de paiement MTN/Orange qui n'utilise PAS Yelii
2. Mettre à jour le schéma Prisma (section 11) + migration
3. Créer la fonction calculateAmountWithCommission (section 1bis)
   → Partagée entre frontend et backend si le monorepo a packages/shared
   → Tester manuellement : 5000 FCFA dû → doit donner 5129 FCFA à payer
4. Créer yelii.service.ts (section 5)
   → Tester manuellement : curl vers /collect/initiate avec la vraie clé
5. Créer le webhook yelii.webhook.ts (section 7)
   → L'enregistrer AVANT express.json() dans index.ts (section 8)
   → Tester la signature : envoyer un faux payload → doit retourner 401
6. Créer la route POST /api/payments/mobile/initiate (section 6)
   → Vérifier qu'elle envoie bien le montant MAJORÉ à Yelii, pas le montant dû
7. Créer la route GET /api/payments/mobile/status/:id (polling)
8. Créer l'écran d'attente USSD dans le frontend (section 4)
   → Afficher le détail montant dû / commission / total à payer
   → Polling toutes les 5s sur la route status
9. Brancher receipt.service.ts sur la confirmation (webhook success)
   → Vérifier que le reçu affiche le montant DÛ, pas le montant majoré
10. Brancher notification.service.ts (WhatsApp) sur la confirmation
11. Créer le job de réconciliation (section 10, filet A)
12. Tester le flow complet avec ngrok de bout en bout :
    initiation → montant majoré affiché → validation téléphone →
    webhook → reçu (montant dû) → WhatsApp
13. Mettre à jour CLAUDE.md avec les nouvelles routes et le schéma
```

---

*Fichier de référence — Flow Mobile Money Yelii · SGM-CEM*
*Culte d'Enfants de Melen · EEC Melen · Yaoundé, Cameroun*
*Concentré uniquement sur le Mobile Money via Yelii. Suivre les 4 étapes de la doc. Ne jamais confirmer sans webhook (RB-02).*
