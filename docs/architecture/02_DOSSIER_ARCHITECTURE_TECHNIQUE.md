# Dossier d'architecture technique — SGM-CEM

| Élément | Valeur |
|---|---|
| Version | 1.0 — 17/10/2026 |
| Statut | Référence technique, base des décisions d'architecture (ADR) |
| Périmètre | Monorepo `sgm-cem/` (apps/api, apps/web, packages/shared), infrastructure, intégrations |
| Documents liés | `01_CAHIER_DES_CHARGES_FONCTIONNEL.md` (exigences EF, RG, ENF), `03_GUIDE_DEPLOIEMENT_PRODUCTION.md`, `04_POLITIQUE_SECURITE_CONFORMITE.md`, `RAPPORT_AUDIT_SGM-CEM.md` (constats V-xx et UX-xx) |

---

## 1. Synthèse pour décideurs

**Verdict.**
- Le **style d'architecture est le bon** : un monolithe modulaire TypeScript, une API Express, une PWA Next.js et PostgreSQL, adaptés à une communauté de quelques milliers de personnes et à une petite équipe.
- Les **fondations transverses sont fragiles** :
  - autorisations au niveau des routes plutôt que des enregistrements ;
  - états financiers mutables sans grand livre ;
  - jobs exécutés dans le processus web ;
  - schéma sans migrations ;
  - dépendances en fin de vie, dont **Node 20, en fin de vie depuis le 30/04/2026** ;
  - aucune observabilité de production.
- Le **frontend** est une SPA à route unique, pensée pour le bureau.

**Dix décisions structurantes proposées** (détail au §6) :
1. **Monolithe modulaire conservé**. On ajoute un **processus worker** séparé (même code, même image) pour les PDF, les notifications, les webhooks et les crons. Redis et BullMQ, déjà prévus, deviennent réellement utilisés.
2. **Même origine** : `https://<domaine>/` sert le web, `https://<domaine>/api` sert l'API, derrière Caddy. Il n'y a plus de CORS, et les cookies sont `SameSite=Strict` et `Secure`.
3. **Politique d'autorisation centralisée** `can(acteur, action, ressource)`, appliquée à chaque enregistrement. Le service `contribution-access.service.ts` existant en est le noyau.
4. **Machine à états unique** pour la contribution, et **grand livre des mouvements de fonds** en ajout seul.
5. **Boîte de réception des webhooks** et **table des tentatives de paiement** (idempotence, rejeu, réconciliation).
6. **Migrations Prisma versionnées**, avec une ligne de base créée à partir du schéma actuel. `db push` est interdit en production.
7. **Rendu PDF isolé** : modèles échappés, réseau coupé, conteneur dédié.
8. **Frontend mobile-first** : une route par écran, des groupes de routes par rôle, `next/dynamic`, et antd v6 comme bibliothèque unique avec Tailwind.
9. **Observabilité** : journaux JSON (pino) avec identifiant de requête, suivi des erreurs, métriques métier, sonde de disponibilité.
10. **Socle à jour** : Node 24 LTS, Next 16, Express 5, Prisma 7, PostgreSQL 17, antd 6, Zod 4. La migration se fait par lots, avec non-régression.

---

## 2. Facteurs et contraintes d'architecture

| Facteur | Conséquence |
|---|---|
| Petite équipe (1 à 3 développeurs, en partie bénévoles) | Simplicité opérationnelle avant tout : un seul dépôt, une seule image, Docker Compose, pas de Kubernetes ni de microservices |
| Budget d'hébergement faible (10 à 40 €/mois) | VPS unique dimensionné, plus un stockage objet et une sauvegarde hors site |
| Utilisateurs sur smartphones d'entrée de gamme en 3G | Budget JavaScript strict, rendu rapide, PWA, tolérance aux coupures |
| Argent réel (MoMo, carte, espèces) | Intégrité transactionnelle, idempotence, audit en ajout seul, séparation des tâches |
| Prestataires locaux (Yelii, CinetPay) aux API hétérogènes | Couche d'adaptation, vérification côté serveur, réconciliation |
| Loi n° 2024/017 (en vigueur depuis le 23/06/2026) | Choix du lieu d'hébergement, registre des sous-traitants, autorisation APDP pour les transferts hors du Cameroun (doc 04) |
| Configuration modifiable à chaud par un développeur | Conserver `system_configs`, mais chiffrer les secrets et réauthentifier pour les révéler |

---

## 3. Architecture actuelle (constatée au commit `ca99669`)

### 3.1 Contexte (C4, niveau 1)

```
 Membres, staff (PWA mobile)    Donateurs externes (lien public)
            │                               │
            ▼                               ▼
   ┌──────────────────────── SGM-CEM ────────────────────────┐
   │  Web Next.js  ──(HTTP, cookies)──►  API Express          │
   └──────────────────────────────────────────────────────────┘
      │          │          │          │         │        │
   Yelii     CinetPay   360dialog   Twilio     SMTP   Google Identity
 (MTN/Orange) (carte)  (WhatsApp)   (SMS)    (e-mail)  (OAuth)       + S3 (R2/Supabase), Web Push
```

### 3.2 Conteneurs (C4, niveau 2)

| Conteneur | Technologie | Rôle | Observations |
|---|---|---|---|
| `web` | Next.js 15.1.6, React 19.2.7, Tailwind 4, antd 5.29, Zustand, TanStack Query, framer-motion, Recharts | PWA : une page `/dashboard` qui commute 25 vues selon l'état `activeView` | Une seule route ; 849 kB de JS au premier chargement ; `NEXT_PUBLIC_*` figées au build |
| `api` | Node 20, Express 4.22, Prisma 5.22, Zod 3, jsonwebtoken, csrf-csrf, helmet, Socket.IO 4.8, Puppeteer 21, node-cron | REST (19 routeurs, environ 110 routes), webhooks, temps réel, PDF, crons | Crons et Chromium dans le processus HTTP ; 23 `new PrismaClient()` |
| `postgres` | PostgreSQL 15 | Données | `db push`, pas de migrations ; port publié, identifiants par défaut |
| `redis` | Redis 7 | **Inutilisé** | Port publié sans mot de passe |
| Stockage | S3 compatible ou disque local `uploads/` | Reçus, bordereaux, GED, avatars | Reçus publics permanents ; avatars non servis en local |

### 3.3 Composants de l'API (C4, niveau 3)

```
index.ts (helmet, cors, cookie-parser, webhooks avant json, json 10 Mo, rate-limit global, CSRF double-submit)
 ├─ middleware/   auth (JWT cookie|Bearer) · rbac (requireLevel/requireRole) · errorHandler (AppError, Zod) · validation (peu utilisé)
 ├─ routes/       auth · users · membres · rubriques · contributions · payments · collecteurs · funds · collectes · public
 │                commissions(GED) · prestations · stats · settings · notifications · profile · audit · activity · developer
 ├─ webhooks/     yelii (HMAC-SHA512 sur JSON re-sérialisé) · cinetpay (x-token HMAC-SHA256 + /payment/check)
 ├─ services/     yelii · cinetpay · payment-status (synchro) · payment-batch (lots) · receipt/borderau/financial-report (Puppeteer)
 │                notification (WhatsApp/SMS/in-app) · email · push · storage (S3/local) · config (system_configs + cache)
 │                audit · activity-write · collecte · contribution-access (NON BRANCHÉ) · cron (relevé mensuel)
 ├─ jobs/         payment-reconciliation (cron chaque minute, exécution selon l'intervalle configuré)
 └─ lib/          prisma (singleton peu utilisé) · security (secrets JWT) · socket (Socket.IO, salles user/role)
```

### 3.4 Modèle de données (23 modèles, 20 énumérations)

```
User 1─0..1 Membre ─┬─< Contribution >─ Rubrique ─0..1 CollectePublique ─< CollecteDraft
  │                 │       │  │  │
  │                 └─< PaymentBatch (lot)  │  └─ ContributeurExterne
  ├─< UserSession                           ├─ FundsTransfer (transferId) ─ sender/receiver User
  ├─< Notification, PushSubscription        └─ BankDeposit (bankDepositId) ─ depositedBy User
  ├─< AuditLog          Commission ─< Document >─ TypeDocument
  └─< Document          Prestation ─< CoursPrestation, EntreePrestation
SystemSettings (singleton) · SystemConfig ─ SystemConfigHistory · OtpCode · ActivitySession ─< ActivityTab, ActivityPageAggregate
```

**Points d'attention sur le modèle :**
- `Contribution` cumule tout : métier, paiement, fonds, reçu, preuve, litige, autorisation. Elle a **deux statuts** (`statut`, `paymentStatus`) qui peuvent diverger (par exemple `EN_ATTENTE_CONFIRMATION` + `FAILED`).
- `collecteurId` signifie à la fois « auteur de la collecte » et « détenteur actuel » : il est écrasé à la réception d'un transfert, ce qui fait perdre l'historique.
- `localisationFonds` est **mutable** : aucun grand livre ne permet de reconstituer la position à une date donnée.
- Champs morts ou non branchés : `proofUrl`, `proofUploadedAt`, `notificationToken`, `isAnnualReference`, `confirmationAuthorization`, `remindersSentCount`, `lastReminderSentAt`, `Document.version`, `CONFIRM_OVERRIDE`. Plusieurs champs de `SystemSettings` n'ont aucun effet.
- `externalTransactionId` n'est plus unique (lots) et la clé fournisseur n'est pas modélisée : il n'existe pas d'entité « tentative de paiement ».
- Pas de contrainte XOR en base pour `membreId` / `contributeurExterneId`. `whatsappPhone` n'est pas unique.

### 3.5 Flux critiques actuels

**Paiement Mobile Money (simple) :**
```
Web ──POST /api/payments/initiate──► API: verrou advisory(membre|rubrique|mode|montant)
     → Contribution(EN_ATTENTE, PENDING) → Yelii /collect/initiate (montant majoré)
     → OK : externalTransactionId, PROCESSING ; incertain : PROCESSING sans txId (orphelin)
Web ──GET /api/payments/status/:id (toutes les 5 s)──► API → Yelii /collect/status → updateMany conditionnel → reçu PDF + notification
Yelii ──POST /webhooks/yelii──► vérification HMAC → 200 immédiat → traitement en arrière-plan (setImmediate, perdu si crash)
Cron (chaque min) → contributions PROCESSING > 15 min → même synchro
```
**Faiblesses :**
- traitement du webhook non durable (`setImmediate`) ;
- pas de clé d'idempotence transmise au fournisseur ;
- contrôle de montant ligne par ligne, cassé pour les lots ;
- alertes dédupliquées en mémoire.

**Chaîne des fonds :**
- `POST /funds/transfer` → `EN_TRANSIT` → `PATCH confirm|refuse|cancel` ;
- raccourcis non contrôlés : `PATCH /collecteurs/claim` et `PATCH /collecteurs/transfer` ;
- lectures puis écritures non conditionnelles (concurrence).

### 3.6 Mécanismes transverses actuels

| Mécanisme | Implémentation | Évaluation |
|---|---|---|
| Authentification | JWT HS256 en cookie HttpOnly (15 min) + refresh 7 j stocké en base | Pas de rotation, pas de révocation à la désactivation |
| CSRF | csrf-csrf double-submit lié au cookie `access_token` | Correct ; secret par défaut toléré en production |
| Autorisation | `requireLevel(n)` / `requireRole()` par route | Pas de contrôle par enregistrement ; incohérences entre web et API |
| Validation | Zod inline dans les routes | Bonne couverture ; un middleware `validate` divergent |
| Configuration | `getConfig()` : cache base → `process.env` | Bonne idée ; secrets en clair en base |
| Audit | `audit()` (best-effort) **et** `prisma.auditLog.create` direct (plus de 20 appels) | Double mécanisme ; actions manquantes |
| Temps réel | Socket.IO, salles `user:<id>` et `role:<role>` | `broadcastToAll` de nature financière |
| Jobs | node-cron in-process | Doublonnés si plusieurs instances ; pas de reprise |
| PDF | Puppeteer : un navigateur par document | Coûteux, non isolé, injection HTML |
| Journaux | `console.*` | Non structurés, pas d'identifiant de corrélation |
| Tests | vitest + supertest sur base réelle partagée | Dépendent d'un seed et de l'environnement ; pas de couverture |
| CI | type-check, tests API, build web/API | Ne peut pas passer sans seed ; pas d'audit de dépendances ni de lint web |

---

## 4. Évaluation par axe

| Axe | Note /5 | Forces | Faiblesses majeures (renvois) |
|---|---|---|---|
| Sécurité | 2 | Cookies HttpOnly, CSRF, helmet, HMAC des webhooks, vérification CinetPay, jetons de brouillon hachés, panneau dev strict | V-01 Next RCE, V-02 identifiants par défaut, V-03/V-04 RBAC, V-06 injection PDF, V-07 sessions, V-08 ports exposés, V-17 secrets en clair |
| Intégrité financière | 2 | Montants entiers, formule de commission unique, transitions conditionnelles, verrous advisory, idempotence des lots | V-05 lots, V-12 initiation, V-13 concurrence, pas de grand livre ni de remboursement |
| Fiabilité | 2,5 | Polling + webhook + réconciliation, statut `unknown` ≠ `failed` | Webhooks non durables, crons in-process, Chromium dans le chemin des requêtes |
| Performance | 2,5 | Index pertinents sur `Contribution` | 849 kB de JS, agrégations en mémoire, pools Prisma multiples |
| Maintenabilité | 3 | TypeScript strict, monorepo, logique partagée, nommage clair, commentaires utiles | Routes « fourre-tout » (≥ 700 lignes), code mort, doublons de composants UI |
| Exploitabilité | 1,5 | Healthcheck, guide Docker détaillé | Pas de migrations, de sauvegardes, de supervision, ni de journaux structurés ; trois cibles de déploiement concurrentes (VPS, Render, Netlify) |
| UX mobile | 2 | Responsive, `100dvh`, safe-area, PWA | UX-01 à UX-17 |

---

## 5. Architecture cible

### 5.1 Principes
1. **Le serveur décide** : statuts, montants, droits et capacités sont calculés côté API. Le client affiche.
2. **Ajout seul pour l'argent** : on ne modifie ni ne supprime une écriture financière ; on compense.
3. **Toute intégration externe est asynchrone, idempotente et rejouable.**
4. **Une seule source de vérité par règle** (`packages/shared` pour les calculs, `policy` pour les droits).
5. **Simplicité opérationnelle** : une image, deux processus (web API, worker), une base, un Redis, un proxy.
6. **Mobile-first et budget de performance** inscrits dans la CI.

### 5.2 Vue d'ensemble cible

```
                  Internet (HTTPS uniquement, HSTS)
                               │
                        ┌──────▼──────┐  TLS automatique, en-têtes de sécurité, compression,
                        │   Caddy 2   │  limitation de débit L7 de base, journaux d'accès
                        └──┬───────┬──┘
              /*  (web)    │       │   /api/* · /webhooks/* · /socket.io/*
                   ┌───────▼──┐  ┌─▼─────────────┐        ┌──────────────────────┐
                   │ web      │  │ api (Express 5)│──────►│ worker (même image)  │
                   │ Next 16  │  │ HTTP sans état │ jobs  │ BullMQ : pdf, notif, │
                   │ standalone│  │ + Socket.IO   │◄──────│ webhook-inbox, recon,│
                   └──────────┘  └──┬─────────┬──┘ Redis │ crons (planificateur │
                                    │         │          │ unique)              │
                             ┌──────▼───┐ ┌───▼────┐     └──┬────────────┬──────┘
                             │PostgreSQL│ │ Redis  │        │            │
                             │17 (privé)│ │(privé, │   Gotenberg     Yelii / CinetPay /
                             └────┬─────┘ │ mdp)   │   (PDF, réseau   360dialog / Twilio /
                                  │       └────────┘    coupé)        SMTP / S3
                        Sauvegardes chiffrées hors site (restic → S3) + WAL (option)
```

### 5.3 Découpage modulaire de l'API

```
apps/api/src
 ├─ modules/
 │   ├─ identity/       (auth, sessions, users, OTP, mots de passe)            ← routes /api/v1/auth, /users
 │   ├─ members/        (membres, couples, import)
 │   ├─ catalog/        (rubriques, collectes publiques)
 │   ├─ contributions/  (machine à états, déclarations, validations, litiges, reçus)
 │   ├─ payments/       (tentatives, lots, adaptateurs fournisseurs, webhooks inbox, réconciliation)
 │   ├─ treasury/       (grand livre des fonds, transferts, dépôts, reversements, clôtures)
 │   ├─ refunds/        (remboursements, contre-écritures)
 │   ├─ documents/      (GED), events/ (prestations)
 │   ├─ notifications/  (outbox, canaux, préférences, modèles)
 │   ├─ reporting/      (stats SQL, exports serveur, PDF)
 │   └─ platform/       (config, audit, observabilité, panneau développeur)
 │   Chaque module : http/ (routes minces, schémas Zod in/out) · application/ (cas d'usage) · domain/ (règles pures) · infra/ (Prisma, adaptateurs)
 ├─ shared/policy/      can(actor, action, resource) + périmètres de requête (scopes)
 ├─ shared/http/        erreurs, pagination curseur, requestId, contexte d'acteur
 ├─ worker.ts           point d'entrée du processus worker (files BullMQ, planificateur)
 └─ server.ts           point d'entrée HTTP
```
Règle de dépendance : `http → application → domain`. `infra` implémente des ports définis par `application`, et `domain` n'importe rien d'externe. La migration se fait **module par module**, en commençant par `contributions`, `payments` et `treasury`.

### 5.4 Modèle de données cible (évolutions)

| Évolution | Description | Exigences couvertes |
|---|---|---|
| `contributions.status` unique | Énumération `EN_ATTENTE`, `A_VERIFIER`, `CONFIRMEE`, `EN_LITIGE`, `ANNULEE`, `ECHOUEE`, `REMBOURSEE` ; `paymentStatus` remplacé par la tentative de paiement ; colonne `version` pour le verrou optimiste | RG-18, §7.1 |
| `payment_attempts` | `id`, `provider`, `providerRef`, `idempotencyKey` (unique, transmise au fournisseur), `amountExpected`, `amountReported`, `currency`, `status`, `rawStatusHash`, `batchId?`, `contributionId?`, horodatages | RG-10/11, EF-M05-08 |
| `webhook_events` (inbox) | `provider`, `eventId`/hash unique, `signatureValid`, `payload` (chiffré ou épuré), `receivedAt`, `processedAt`, `attempts`, `error` | Durabilité, rejeu, idempotence |
| `fund_movements` (grand livre) | Ajout seul : `contributionId`, `from`, `to`, `holderFrom`, `holderTo`, `transferId?`, `depositId?`, `actorId`, `at`. La localisation courante devient une **vue** | RG-20/21, ENF-06 |
| `contributions.detenteurId` | Séparé de `collecteurId` (auteur immuable) | RG-22 |
| `refunds` | `contributionId`, `amount`, `method`, `reason`, `requestedBy`, `approvedBy1/2`, `status`, `providerRef?` | M16 |
| `period_closings` | Clôture mensuelle : positions, écarts, PDF, verrou | EF-M07-09 |
| `notification_outbox` | Événement → canaux → tentatives → statut (au lieu d'appels directs synchrones) | M09 |
| `provider_payouts` | Reversements du compte prestataire vers la banque, frais et net | EF-M07-06 |
| Contraintes SQL | `CHECK (num_nonnulls(membre_id, contributeur_externe_id) = 1)` (sauf remise groupée typée) ; `UNIQUE(whatsapp_phone)` ; `CHECK (montant > 0)` ; partial unique « une contribution par transfert en attente » | RG-01/02/23 |
| `audit_logs` | Rôle SQL de l'application sans `UPDATE`/`DELETE` sur la table (ajout seul) ; partition annuelle à terme | EF-M13-01 |
| `system_configs.value` | Chiffrement AES-256-GCM pour `isSecret` (clé maîtresse dans l'environnement, rotation documentée) | V-17 |

### 5.5 Intégrations de paiement (patron cible)

```ts
interface PaymentProvider {
  initiate(input: { idempotencyKey: string; amount: number; currency: 'XAF'; payer: Payer; channel: Channel; callbackUrl: string }): Promise<InitiateResult> // jamais d'exception pour un refus métier
  getStatus(ref: ProviderRef): Promise<{ status: 'pending'|'success'|'failed'|'unknown'; amount?: number; currency?: string }>
  verifyWebhook(rawBody: Buffer, headers: Headers): VerifiedEvent | null // sur les OCTETS bruts
}
```
1. **Initiation** : créer `payment_attempt(idempotencyKey)` **avant** l'appel ; envoyer la clé au fournisseur (référence externe) ; en cas de délai dépassé, état `A_VERIFIER`, que la réconciliation retrouve par la clé.
2. **Webhook** : vérifier la signature sur le corps brut, insérer dans `webhook_events` (unique), répondre 200, puis traitement **par le worker** (BullMQ, 5 tentatives, backoff exponentiel).
3. **Confirmation** : dans une transaction, comparer au montant attendu (lot ou contribution), passer **toutes** les lignes, écrire le mouvement de fonds `→ COMPTE_PRESTATAIRE`, puis enfiler les jobs « reçu PDF » et « notification » via l'outbox.
4. **Réconciliation** : interroger les tentatives `A_VERIFIER` ou `pending` de plus de 15 min ; au-delà de 24 h → `EN_LITIGE` + alerte. Un rapprochement quotidien avec l'historique du fournisseur s'ajoute dès que l'API le permet.

### 5.6 Sécurité (architecture cible)

| Sujet | Cible |
|---|---|
| Exposition | Même origine via Caddy ; seuls 80 et 443 sont ouverts ; base et Redis sur le réseau interne uniquement |
| Mots de passe | Argon2id (`@node-rs/argon2`), rehachage progressif des hash bcrypt à la connexion ; 10 caractères minimum ; liste noire |
| Sessions | Table `sessions` (famille de jetons, rotation, détection de réutilisation) ; contrôle `isActive` et `tokenVersion` à chaque rafraîchissement ; incrément de version à la désactivation, au changement de mot de passe ou de rôle |
| Autorisation | `policy.can()` + périmètres de requête (`scopeContributions(actor)`) ; tests de matrice générés |
| CSRF | Double-submit conservé + `SameSite=Strict` ; `CSRF_SECRET` obligatoire en production |
| Limitation de débit | `express-rate-limit` 8 + store Redis ; clés : IP (anonyme), `userId` (connecté), téléphone et e-mail (OTP, connexion) ; `trust proxy` = 1 |
| En-têtes | CSP avec nonces (Next), HSTS, `frame-ancestors 'none'`, `Referrer-Policy strict-origin-when-cross-origin`, `Permissions-Policy` |
| Fichiers | Bucket privé ; URL signées de 5 min (staff) et 30 j (reçus partagés) ; type réel contrôlé (magic bytes) ; taille bornée ; nom aléatoire |
| PDF | Gotenberg (conteneur sans accès réseau sortant) ou Puppeteer dans le worker avec `setJavaScriptEnabled(false)` + interception des requêtes ; modèles avec échappement automatique |
| Secrets | `.env` hors dépôt, permissions 600 ; secrets métier chiffrés en base ; révélation après réauthentification ; rotation planifiée (doc 04) |
| Dépendances | `pnpm audit --prod` bloquant en CI (niveau high) ; Renovate hebdomadaire ; image de base rafraîchie chaque mois |

### 5.7 Frontend cible

| Sujet | Cible |
|---|---|
| Routage | App Router : `/(public)/collecte/[slug]`, `/(auth)/connexion`, `/(app)/accueil`, `/(app)/payer`, `/(app)/historique/[id]`, `/(app)/validations/[id]`, `/(app)/fonds/...`, `/(admin)/...`. Les feuilles inférieures sont des routes interceptées (`@modal`). Les filtres sont dans `searchParams` |
| Données | TanStack Query conservé ; clés par ressource ; invalidation ciblée ; état serveur jamais copié dans Zustand (Zustand limité à l'état d'interface) |
| Composants | **antd v6** (Form, Select, Drawer `placement="bottom"`, Modal, Segmented, Steps, Skeleton, Empty, App/message/modal) + Tailwind pour la mise en page. Suppression des paquets Radix inutilisés et des doublons `components/ui/*`. Aucun sélecteur `.ant-*` : API sémantique `classNames`/`styles` uniquement |
| Thème | Jetons uniques : thème antd en variables CSS, réutilisés par Tailwind (`@theme`) ; **0 couleur hexadécimale en dur dans les composants** (règle ESLint) |
| Performance | Découpage par route, `next/dynamic` pour Recharts et ExcelJS, `next/font` (Montserrat auto-hébergée), images `next/image`, budget Lighthouse CI (JS ≤ 250 kB à l'accueil membre) |
| PWA | Manifest complet (icônes `maskable`, `id`), service worker (statique en cache d'abord, API en réseau seulement), page hors ligne, invite de mise à jour, file hors ligne idempotente (UUID client) |
| Accessibilité | Zoom autorisé, champs à 16 px, cibles de 44 px, `Form.Item` (libellés liés), `aria-live`, focus géré dans les feuilles ; axe-core en CI |
| Qualité | ESLint (flat) + règles a11y, Testing Library pour les composants critiques, Playwright mobile (360×800) pour les parcours P1 à P6 |

### 5.8 Observabilité

| Signal | Cible |
|---|---|
| Journaux | pino JSON (niveau via `LOG_LEVEL`), `requestId` propagé (en-tête `X-Request-Id`), champs masqués (`password`, `token`, `apikey`, téléphone partiellement) |
| Erreurs | Sentry (SaaS) **ou GlitchTip auto-hébergé** si la souveraineté des données l'exige |
| Métriques | `/api/metrics` (Prometheus, réseau interne) : latence HTTP, files BullMQ, paiements par statut, âge maximum des paiements `A_VERIFIER`, contributions en litige, fonds en retard |
| Disponibilité | Sonde externe (Uptime Kuma auto-hébergé sur une autre machine, ou service SaaS) sur `/api/health` (profond : base + Redis) et `/` |
| Alertes | E-mail/WhatsApp de l'astreinte : API indisponible > 2 min, erreurs 5xx > 2 % sur 5 min, file `webhooks` > 50, paiement `A_VERIFIER` > 1 h, sauvegarde manquante > 26 h, disque > 80 % |

### 5.9 API

- Préfixe `/api/v1` (l'ancien `/api` est conservé en alias pendant une version).
- Contrat **OpenAPI 3.1 généré depuis Zod** (`@asteasolutions/zod-to-openapi` ou équivalent compatible Zod 4), publié en CI ; client typé généré pour le web.
- Enveloppes `{ success, data, pagination? }` / `{ success:false, error:{ code, message, field?, requestId } }` partout. Pagination par curseur pour les listes longues.
- Chaque ressource financière expose ses `actions` (capacités) calculées par `policy`.

---

## 6. Décisions d'architecture (ADR)

> Format : contexte → décision → conséquences. Statut « Proposé » tant que le Bureau technique ne l'a pas validé.

**ADR-001 — Conserver le monolithe modulaire et ajouter un processus worker** *(Proposé)*
- **Contexte :** les crons, PDF et webhooks s'exécutent dans le processus HTTP. Un crash ou plusieurs instances provoquent des pertes ou des doublons.
- **Décision :** une image Docker et deux commandes (`node dist/server.js`, `node dist/worker.js`). BullMQ sur Redis pour les files `pdf`, `notifications`, `webhooks`, `reconciliation`, et un planificateur (`repeat`) qui remplace node-cron, à exécution unique garantie.
- **Conséquences :** Redis devient une dépendance réelle (sauvegarde AOF) ; la latence des requêtes baisse ; les reprises sont automatiques.

**ADR-002 — Même origine derrière Caddy** *(Proposé)*
- **Contexte :** web et API sont sur deux ports ou domaines, avec CORS, cookies `Lax` et IP figée dans le Compose.
- **Décision :** un domaine unique ; Caddy route `/api`, `/webhooks` et `/socket.io` vers l'API, le reste vers le web ; TLS automatique (Let's Encrypt).
- **Conséquences :** suppression de CORS ; `NEXT_PUBLIC_API_URL=/api` ; cookies `__Host-` possibles ; un seul certificat.

**ADR-003 — Autorisation centralisée par politique** *(Proposé — priorité 1)*
- **Contexte :** `requireLevel` par route ; failles V-03, V-04, V-10, V-14 ; un service de politique déjà écrit mais non branché.
- **Décision :** module `policy` avec `can(actor, action, resource)` et `scope(actor, entity)` pour les requêtes ; chaque route financière l'appelle ; les capacités sont renvoyées au client.
- **Conséquences :** tests de matrice obligatoires ; le web n'invente plus de règles.

**ADR-004 — Machine à états unique et grand livre des fonds** *(Proposé)*
- **Contexte :** double statut, `localisationFonds` mutable, `collecteurId` réécrit.
- **Décision :** énumération unique de statuts + transitions déclarées (table de transitions dans `domain`) ; `fund_movements` en ajout seul ; `detenteurId`.
- **Conséquences :** migration de données (script idempotent) ; rapports exacts à date ; contrôle quotidien Σ = total.

**ADR-005 — Tentatives de paiement et boîte de réception des webhooks** *(Proposé)*
- **Contexte :** V-05, V-12, V-25 ; `setImmediate` non durable.
- **Décision :** tables `payment_attempts` et `webhook_events` ; signature sur le corps brut ; traitement par le worker ; clé d'idempotence transmise au fournisseur.
- **Conséquences :** réconciliation déterministe ; rejouabilité ; audit du fournisseur.

**ADR-006 — Migrations Prisma versionnées** *(Proposé — avant toute mise en production)*
- **Contexte :** `db push` au démarrage, risque de perte de données lors d'un changement de type ou de suppression de colonne.
- **Décision :** `prisma migrate diff --from-empty --to-schema-datamodel` → migration `0000_baseline`, marquée appliquée (`migrate resolve --applied`) sur les bases existantes ; ensuite `migrate deploy` uniquement. `db push` est interdit hors poste de développement.
- **Conséquences :** revue des migrations en PR ; sauvegarde avant chaque migration (doc 03).

**ADR-007 — Rendu PDF isolé** *(Proposé)*
- **Contexte :** V-06, Chromium dans l'API, `--no-sandbox`.
- **Décision :** Gotenberg 8 (conteneur interne sans sortie réseau) appelé par le worker, avec modèles HTML **échappés** (moteur à échappement automatique, par exemple Eta ou Handlebars avec `{{ }}` échappé). Alternative : Puppeteer dans le worker, JavaScript désactivé et requêtes bloquées.
- **Conséquences :** l'image API s'allège d'environ 400 Mo ; les PDF ne bloquent plus le web.

**ADR-008 — Frontend : une route par écran, antd v6 unique** *(Proposé)*
- **Contexte :** UX-01, UX-12, UX-15 ; migration v6 testée (doc d'audit).
- **Décision :** App Router par écran ; groupes de routes par rôle ; antd v6 + Tailwind ; suppression de Radix et des doublons.
- **Conséquences :** refonte progressive écran par écran ; gain de performance et d'accessibilité.

**ADR-009 — Socle logiciel supporté** *(Proposé)*
- **Contexte :** Node 20 en fin de vie (30/04/2026) ; Next 15.1.6 vulnérable ; Express 4, Prisma 5 et Zod 3 sur des branches anciennes.
- **Décision :** cibles au §7 ; mise à jour par lots, en commençant par la sécurité (Next, Node).
- **Conséquences :** chantier de compatibilité (Express 5 : `req.query` en lecture seule, gestion asynchrone native ; Prisma 7 : `prisma.config.ts`, adaptateur `pg` obligatoire, nouveau générateur ; Zod 4 : `issues`, nouvelles API de format).

**ADR-010 — Hébergement : VPS unique conteneurisé, une seule cible canonique** *(Proposé)*
- **Contexte :** trois cibles documentées (Docker local, Render, Netlify) ; loi 2024/017 ; budget.
- **Décision :** cible canonique = **VPS Docker Compose + Caddy** (doc 03). Les fichiers `render.yaml` et `netlify.toml`, ainsi que leurs guides, sont archivés dans `docs/archives/`. Le choix du pays d'hébergement est validé selon la doc 04 : hébergeur au Cameroun, ou hors Cameroun avec autorisation APDP.
- **Conséquences :** un seul runbook ; coûts maîtrisés.

**ADR-011 — Secrets** *(Proposé)*
- **Décision :** l'infrastructure (`DATABASE_URL`, `JWT_*`, `CSRF_SECRET`, `CONFIG_ENCRYPTION_KEY`, `REDIS_PASSWORD`) n'existe que dans `.env` (600). Les clés métier restent dans `system_configs`, **chiffrées** et modifiables à chaud.

**ADR-012 — Observabilité minimale obligatoire** *(Proposé)*
- **Décision :** pino + requestId, suivi d'erreurs, métriques, sonde de disponibilité et alertes du §5.8 avant la mise en production.

---

## 7. Versions cibles du socle (vérifiées sur les registres le 17/10/2026)

| Composant | Actuel | Dernière stable observée | Cible recommandée | Remarques de migration |
|---|---|---|---|---|
| Node.js | 20 (image `node:20-slim`) — **fin de vie le 30/04/2026** | 24.22.0 LTS « Krypton » ; 26.x « Current » | **24 LTS** (`node:24-slim` ou `-bookworm-slim`) | Tester bcrypt (natif) ou passer à Argon2 ; `fetch` natif déjà utilisé |
| pnpm | 8.15.4 (CI : 9) | 12.x | 10.x (corepack, `packageManager` épinglé) | Regénérer le lockfile ; aligner CI et Docker |
| TypeScript | 5.9 | 7.0 (compilateur natif) | 5.9 maintenant, 7.x à évaluer en 2027 | TS 7 change l'outillage ; pas urgent |
| Next.js | **15.1.6 (vulnérable)** | 16.4.2 ; branche 15 : 15.5.28 | Immédiat : **15.5.28** ; ensuite **16.4.x** | 16 : Turbopack par défaut, `next lint` supprimé (ESLint CLI), API de requête asynchrones, `middleware` renommé `proxy` |
| React | 19.2.7 | 19.3.1 | 19.3.x | — |
| antd | 5.29 | 6.6.6 | **6.6.x** | Correctif testé : 4 dépendances, 7 lignes (rapport d'audit) |
| @ant-design/nextjs-registry | 1.2.0 | 1.3.0 | 1.3.x | + `@ant-design/cssinjs` ^2 |
| Tailwind CSS | 4.x | 4.3.3 | 4.3.x | — |
| TanStack Query / Zustand | 5.x / 5.x | 5.104 / 5.0.15 | dernières 5.x | — |
| Express | 4.22 | 5.3.0 | **5.3.x** | `req.query` en lecture seule (adapter `middleware/validation.ts`) ; erreurs asynchrones natives (retirer `express-async-errors`) ; syntaxe des chemins de path-to-regexp 8 |
| express-rate-limit | 7.x | 8.7.1 | 8.x + `rate-limit-redis` 6 | Clés par utilisateur |
| Prisma | 5.22 | client 7.10.1 (le tag `latest` du CLI pointe sur une RC 8 : **ne pas l'utiliser**) | **7.10.x** stable | `prisma.config.ts`, adaptateur `@prisma/adapter-pg`, générateur `prisma-client` avec `output` explicite ; à faire **après** la ligne de base des migrations |
| Zod | 3.23 | 4.6.7 | 4.x | `error.errors` → `error.issues` ; formats de premier niveau (`z.email()`) |
| Socket.IO | 4.8.3 | 4.8.4 | 4.8.4 | Corrige les CVE engine.io / socket.io-parser |
| Puppeteer | 21.11 | 25.14 | Gotenberg 8 (ADR-007), ou Puppeteer 25 dans le worker | Supprime tar-fs, ws et extract-zip vulnérables |
| nodemailer | 6.10 | 10.1.2 | 10.x | API stable ; CVE corrigées |
| axios | 1.17 | 1.20.0 | 1.20.x, ou suppression (`fetch` natif) | — |
| multer | 1.4.5-lts | 2.4.0 | 2.x | — |
| jsonwebtoken | 9.0.3 | 9.0.3 | `jose` 6 (option) | jose : API moderne, algorithmes explicites |
| BullMQ / ioredis | non utilisés | 6.3 / 6.0 | **6.x / 6.x** (ADR-001) | — |
| pino | — | 10.4 | 10.x | — |
| Vitest | 1.6 | 5.0.5 | 5.x (+ `@vitest/coverage-v8`) | Corrige les CVE critiques de développement |
| Playwright | — (outil global) | 1.64.1 | `@playwright/test` 1.64 + `@axe-core/playwright` 4.14 | — |
| PostgreSQL | 15 | 18 | **17** (stabilité, extensions) ou 18 | Mise à niveau par `pg_dump`/restauration (doc 03) |
| Redis | 7 (inutilisé) | — | Redis 7.4 ou Valkey 8 | `requirepass`, AOF |
| Caddy | — | — | Caddy 2.x | TLS automatique |

> Règle : **ne jamais déployer une version « canary », « rc » ou « preview »** ; épingler les versions exactes en production (lockfile) ; Renovate propose, la CI valide, un humain fusionne.

---

## 8. Catalogue des propositions d'amélioration

| ID | Proposition | Gain | Effort | Risque si non fait | Lien |
|---|---|---|---|---|---|
| PA-01 | Brancher `contribution-access.service` (politique) sur les routes contributions, collecteurs et funds ; supprimer `/claim` et `/collecteurs/transfer` | Ferme la fraude interne | S | Critique | ADR-003, V-03/04 |
| PA-02 | Confirmation des lots au total et en bloc | Débloque les paiements réels | M | Élevé | ADR-005, V-05 |
| PA-03 | Seed de production minimal, Argon2id, changement forcé côté serveur, révocation des sessions | Ferme la prise de compte | S | Critique | V-02/07 |
| PA-04 | Next 15.5.28 puis 16 ; Node 24 ; Socket.IO, axios, nodemailer, aws-sdk à jour | Supprime une RCE | S→M | Critique | ADR-009 |
| PA-05 | Ligne de base des migrations + interdiction de `db push` | Évolutions sans perte | S | Élevé | ADR-006 |
| PA-06 | Caddy même origine + ports internes + secrets obligatoires | Réduit fortement la surface d'attaque | S | Critique | ADR-002 |
| PA-07 | Worker BullMQ (PDF, notifications, webhooks, crons) | Fiabilité, performance | M | Moyen | ADR-001 |
| PA-08 | PDF isolés et échappés (Gotenberg) | Ferme le SSRF | S | Élevé | ADR-007 |
| PA-09 | `payment_attempts` + `webhook_events` + clé d'idempotence fournisseur | Zéro paiement orphelin | M | Élevé | ADR-005 |
| PA-10 | Machine à états + `fund_movements` + `detenteurId` | Comptabilité juste à date | L | Moyen | ADR-004 |
| PA-11 | Singleton Prisma, agrégations SQL, pagination partout | Stabilité sous charge | S | Moyen | V-21 |
| PA-12 | Routes par écran, groupes par rôle, `next/dynamic`, antd v6 | UX mobile, performance | M→L | Élevé (adoption) | ADR-008 |
| PA-13 | pino + Sentry/GlitchTip + métriques + Uptime Kuma | Détection des incidents | S | Élevé | ADR-012 |
| PA-14 | Chiffrement des secrets en base + réauthentification à la révélation | Défense en profondeur | S | Moyen | ADR-011 |
| PA-15 | OpenAPI généré + client typé | Contrat unique, moins d'erreurs | M | Faible | §5.9 |
| PA-16 | Remboursements et clôture mensuelle | Gouvernance financière | L | Moyen | M16, EF-M07-09 |
| PA-17 | Purge du code et de la configuration morts (Yelii hérité, MTN/Orange directs, Radix, `darkTheme`, interrupteurs non branchés, paramètres sans effet) | Lisibilité | S | Faible | §3.4 |
| PA-18 | Tests : seed de test, isolation, couverture, matrice RBAC, Playwright mobile, axe | Non-régression | M | Élevé | doc 06 |

---

## 9. Plan de migration technique (résumé, détaillé dans `07_FEUILLE_DE_ROUTE.md`)

| Lot | Contenu | Prérequis | Sortie (définition de terminé) |
|---|---|---|---|
| L0 — Sécurité immédiate (1 sem.) | PA-01, PA-03, PA-04 (Next 15.5.28, Node 24), PA-06, PA-08, rotation des secrets | — | `pnpm audit --prod` sans critique ni élevée ; tests RBAC verts ; preuves P1 à P5 rejouées en échec |
| L1 — Fiabilité des paiements (2 sem.) | PA-02, PA-05, PA-09, PA-13, CI réparée | L0 | Recette paiements (doc 06 §5) verte en sandbox ; tableau de bord d'alertes actif |
| L2 — Mobile-first (3 à 4 sem.) | PA-12 (routes, onglets, accueil par rôle, parcours payer, Encaisser), antd v6 | L0 | Lighthouse et axe dans les budgets ; parcours P1 à P6 validés sur appareils réels |
| L3 — Socle et domaine (4 à 6 sem.) | PA-07, PA-10, PA-11, PA-14, Express 5, Prisma 7, Zod 4, Next 16 | L1 | Contrôle Σ quotidien vert ; 0 job in-process |
| L4 — Gouvernance (continu) | PA-15, PA-16, PA-17, conformité 2024/017 | L3 | Clôture mensuelle opérationnelle ; registre à jour |

---

## Annexe A — Inventaire des routes API actuelles (19 routeurs)

| Préfixe | Routes (méthode, chemin → contrôle actuel) |
|---|---|
| `/api/auth` | POST login, forgot-password, otp/request, otp/verify, google (limiteurs) · POST change-password, logout, stop-impersonation · GET me (auth) · POST refresh |
| `/api/users` | GET, POST, PATCH /:id, PATCH /:id/toggle-active, POST /:id/reset-password → ADMIN/DEV |
| `/api/membres` | GET / search /:id (≥ 2) · GET /me (≥ 1) · POST, PATCH /:id, DELETE /:id/couple, PATCH /:id/status, POST /import (≥ 3) |
| `/api/rubriques` | GET (≥ 1) · POST, PATCH /:id, PATCH /:id/status (≥ 3) |
| `/api/contributions` | GET, /validations, /:id/payment-status, /:id/confirm, /:id/litige, /:id/timeline, /:id/receipt, POST / (≥ 2) · /litiges, /:id/resolve-litige (≥ 3) · /me, /me/balance, POST /declare (≥ 1) |
| `/api/payments` | POST /initiate, /batches/initiate, GET /status/:id (≥ 1) · GET /config (auth) · POST /retry-webhook/:tx (≥ 4) |
| `/api/collecteurs` | GET (≥ 2) · GET /eligible-for-declaration (≥ 1) · PATCH /transfer (≥ 3) · PATCH /claim (staff) |
| `/api/funds` | GET /overview, /contributions, /eligible-receivers, /transfers, /transfers/pending-my-approval, /transfers/:id/borderau · POST /transfer · PATCH /transfers/:id/confirm, refuse, cancel (≥ 2) · PATCH /bank-deposit (TRÉSORIER/ADMIN/DEV) · GET /bank-deposits (≥ 4) |
| `/api/collectes` | POST, PATCH /:id (ADMIN/TRÉSORIER/DEV) · GET, GET /:id/contributions (≥ 4) |
| `/api/public` | GET /collectes/:slug · POST /collectes/:slug/drafts · GET/PATCH /drafts · POST /collectes/:slug/initiate · GET /payments/:id/status (sans authentification, limiteurs) |
| `/api/commissions` (GED) | GET /, /types, /storage-mode, /documents, /:id/documents, /documents/:id/download (≥ 1) · POST /documents, PATCH submit (≥ 2) · approve, reject, archive, DELETE (≥ 3) |
| `/api/prestations` | GET, GET /:id (≥ 2) · POST, /:id/cours, /:id/entrees, PATCH close-entrees (≥ 3) · PATCH pay-commission (≥ 4) |
| `/api/stats` | GET /dashboard, /financial-report.pdf, /monthly (≥ 3) |
| `/api/settings` | GET, PATCH (≥ 4) |
| `/api/notifications` | push public-key, subscribe, test, GET, read-all, /:id/read (auth) · POST /broadcast (≥ 3) |
| `/api/profile` | GET, PATCH, POST/DELETE /photo (auth) · POST /:userId/photo (ADMIN/DEV) |
| `/api/audit` | GET (périmètre selon le rôle), GET /users |
| `/api/activity` | heartbeat, end (auth) · overview, users, sessions, actions (ADMIN/DEV) |
| `/api/developer` | config, config/:key, reveal, history, webhook/recalculate, test/yelii, impersonate/:userId (DEVELOPER) |
| Hors `/api` | POST /webhooks/yelii, GET/POST /webhooks/cinetpay, GET /uploads/receipts/* (public), GET /api/health, GET /api/csrf-token |

*Fin du dossier d'architecture technique.*
