# Rapport d'audit — SGM-CEM

**Date :** 17/10/2026 · **Périmètre :** dépôt `devnet8057/sgm-cem`, commit `ca99669`, branche de travail `claude/ecstatic-gates-g8pt2c`.
**Méthode :** lecture complète du backend (routes, services, webhooks, jobs, middlewares, schéma Prisma, seed, Docker, CI), lecture ciblée du frontend. Exécution de type-check, lint, tests, `next build` et `pnpm audit`. Cinq scripts de preuve ont tourné contre une base PostgreSQL locale jetable, avec `fetch` simulé.
**Complément UI/UX mobile-first (v2) :** l'application a été lancée en local (API, web de production, base jetable) et parcourue avec Playwright en **360×800 tactile** pour 4 rôles. Au total : 56 écrans mesurés, des parcours interactifs, une simulation 3G, et une **migration Ant Design v6 réellement testée** sur une copie jetable du monorepo (voir les sections dédiées).
**Garanties :** aucun fichier du dépôt modifié (`git status` vide en fin d'audit). Aucun appel réel à Yelii, CinetPay, WhatsApp, SMS ou e-mail. Aucune transaction. Aucun secret recopié dans ce rapport.

> Légende : **[FAIT]** = constaté dans le code ou prouvé par exécution · **[PREUVE]** = reproduit par un script · **[HYPOTHÈSE]** = déduction non vérifiée en conditions réelles.

---

# Résumé exécutif

## État général du projet
L'application est riche et fonctionnellement avancée : gestion des membres, rubriques, paiements Mobile Money et carte, espèces avec double validation, chaîne de traçabilité des fonds, collectes publiques, reçus PDF, notifications multicanal, GED, panneau développeur et observabilité. Le code compile sans erreur (API et web), le build de production Next.js réussit et la suite de tests passe en grande partie. Plusieurs mécanismes sont bien pensés :
- vérification serveur des paiements CinetPay (`/payment/check`) ;
- HMAC des webhooks en temps constant ;
- transitions conditionnelles (`updateMany … where statut = EN_ATTENTE_CONFIRMATION`) contre la double confirmation ;
- clés d'idempotence et verrous `pg_advisory_xact_lock` sur l'initiation des paiements ;
- jetons de brouillon publics stockés hachés ;
- cookies HttpOnly ;
- panneau développeur réservé au rôle exact `DEVELOPER`.

En revanche, **l'intégrité financière et le contrôle d'accès ont des failles exploitables par des rôles internes** : collecteur, responsable. Le socle de dépendances, Next.js en tête, est **gravement obsolète**, et la configuration de déploiement **n'est pas prête pour une exposition Internet**.

## Risques majeurs
1. **Next.js 15.1.6** : vulnérabilités critiques connues, dont une exécution de code à distance non authentifiée via le protocole React Flight (`pnpm audit` : 11 critiques, 78 élevées sur l'ensemble du monorepo).
2. **Identifiants par défaut versionnés** : le seed lancé automatiquement au premier démarrage crée trésorier, responsable, adjoint, 2 collecteurs et 20 membres de démonstration avec un mot de passe commun présent dans le dépôt, et `mustChangePassword = false` **[PREUVE]**.
3. **Confirmation de paiements fictifs** : un collecteur peut confirmer manuellement une contribution Mobile Money jamais payée. Elle passe `CONFIRME / SUCCESS` et un reçu est émis **[PREUVE]**.
4. **Détournement de la chaîne des fonds** : n'importe quel collecteur peut « réceptionner » un transfert destiné au trésorier, en contournant la validation par le destinataire **[PREUVE]**.
5. **Paiements multi-rubriques jamais confirmés automatiquement** : chaque ligne d'un lot est comparée au montant total de la transaction, donc l'écart est systématique et le statut reste bloqué en attente **[PREUVE]**.
6. **Injection HTML dans les PDF rendus par Chromium côté serveur** : un nom saisi sur la page publique est injecté brut, avec `--no-sandbox` et chargement réseau actif. C'est un vecteur de SSRF **[PREUVE au niveau HTML]**.
7. **Sessions non révoquées** : un compte désactivé peut encore rafraîchir sa session pendant 7 jours **[PREUVE]**.
8. **Infrastructure** : PostgreSQL (`postgres/postgres`) et Redis (sans mot de passe, et inutilisé) sont publiés sur l'hôte. Le rate-limit global est de 100 requêtes / 15 min / IP sans `trust proxy`, donc tous les utilisateurs derrière un proxy partagent le même quota.

## Expérience mobile (complément v2)
L'interface est **responsive**, mais elle n'est **pas encore mobile-first**. Aucun débordement horizontal global n'a été mesuré, et les tableaux se transforment en cartes. En revanche, la conception reste celle d'un back-office de bureau replié sur un écran de téléphone : navigation dans un tiroir, pages très longues, formulaires denses, petites cibles tactiles. Constats majeurs mesurés :
- **Le bouton « retour » d'Android fait quitter l'application** : la navigation ne touche jamais l'historique. Un rafraîchissement ramène toujours au tableau de bord **[PREUVE]**.
- **Collecteur** : les entrées « Rubriques » et « Fonds à réceptionner » affichent en réalité son tableau de bord. Un collecteur destinataire d'un transfert ne peut donc pas le valider **[PREUVE]**.
- **Membre** : aucun accès à ses reçus ni au détail d'une contribution. Les totaux « Montant confirmé » et « En attente » ne portent que sur la page affichée (20 lignes) **[FAIT]**.
- **Page publique de collecte** : le titre et le statut urgent de la collecte ne sont jamais affichés, et le champ téléphone déborde de la carte **[PREUVE]**.
- **Accessibilité tactile** : 688 cibles de moins de 44 px et 156 champs sans libellé programmatique sur 56 écrans. Le zoom est bloqué (`maximumScale: 1`).
- **Performance en 3G** : 849 kB de JavaScript au premier chargement de `/dashboard` ; tableau de bord exploitable en **7,2 s** (connexion de 1,6 Mbit/s, latence de 300 ms, CPU ralenti 4×).
- **Ant Design v6** : la migration est **possible et peu coûteuse**. Sur une copie, 4 dépendances et 7 lignes de code ont changé : type-check OK, build OK, 23/23 tests, aucun avertissement console. Seule régression : la feuille de paiement plein écran sur mobile, à corriger avec l'API sémantique `classNames`.

## Priorités immédiates (avant toute mise en production)
1. Mettre à jour Next.js (≥ 15.5.24) et les dépendances runtime vulnérables.
2. Neutraliser les comptes seedés : pas de seed démo en production, mots de passe aléatoires, `mustChangePassword` imposé **côté serveur**.
3. Restreindre `PATCH /contributions/:id/confirm` aux espèces et virements, et `PATCH /collecteurs/claim` au destinataire d'un transfert.
4. Corriger la confirmation des lots multi-rubriques (comparer au total du lot).
5. Échapper tout le HTML des PDF et isoler Chromium (bloquer les requêtes réseau).
6. Révoquer les sessions à la désactivation et au changement de mot de passe ; vérifier `isActive` au refresh.
7. Fermer les ports PostgreSQL et Redis, changer les mots de passe de base, rétablir `trust proxy` et revoir le rate-limit.
8. Lever les blocages UX mobiles : navigation par URL (bouton retour), vues manquantes du collecteur, reçus et totaux justes pour le membre, titre de la collecte publique (UX-01 à UX-04).

---

# Architecture et technologies

## Schéma textuel des composants

```
                ┌──────────────────────────── Navigateur (PWA) ───────────────────────────┐
                │ Next.js 15 App Router (React 19) — SPA mono-route /dashboard             │
                │ Zustand (auth persistée sans jetons) · TanStack Query · Socket.IO client │
                │ Service Worker (cache statique) · IndexedDB (file hors ligne)            │
                └───────────────┬──────────────────────────────────────┬──────────────────┘
                     HTTPS/HTTP │ cookies HttpOnly + X-CSRF-Token      │ WebSocket (cookie JWT)
                                ▼                                      ▼
   ┌──────────────── API Express 4 (apps/api, port 3001) ──────────────────────────────────┐
   │ helmet · cors · cookie-parser · express-rate-limit · csrf-csrf (double-submit)        │
   │ /api/* (19 routeurs, Zod, RBAC par niveaux) · /webhooks/yelii · /webhooks/cinetpay    │
   │ Services : paiements (Yelii, CinetPay, lots), reçus/bordereaux/rapports (Puppeteer),  │
   │ notifications (in-app, Web Push, WhatsApp 360dialog, SMS Twilio, SMTP), stockage S3   │
   │ Jobs node-cron in-process : réconciliation (10 min), relevé mensuel, rétention        │
   │ Config dynamique : table system_configs (cache mémoire) → fallback process.env        │
   └──────┬────────────────────────┬───────────────────────┬──────────────────────────────┘
          │ Prisma 5               │ HTTP sortant          │ fichiers
          ▼                        ▼                       ▼
   PostgreSQL 15            Yelii · CinetPay ·       S3 / R2 / Supabase
   (db push, pas de         360dialog · Twilio ·     ou disque local uploads/
    migrations)             SMTP · Google · FCM/
                            Mozilla (Web Push)
   Redis 7 : déployé mais **aucun code ne l'utilise** (BullMQ/ioredis importés nulle part).
```

**Type :** monolithe modulaire en monorepo pnpm (`apps/api`, `apps/web`, `packages/shared` pour les calculs de commission, de solde et de lots). Pas de microservices et pas de worker séparé : les crons tournent dans le processus API. Il n'y a pas d'application mobile native, seulement une PWA.

## Technologies détectées (versions résolues dans le lockfile)

| Domaine | Technologie | Version |
|---|---|---|
| Runtime | Node.js | ≥ 20 (images `node:20-slim`) |
| Gestionnaire | pnpm | 8.15.4 (`packageManager`), **9 en CI** |
| Backend | Express | 4.22.2 |
| ORM | Prisma / @prisma/client | 5.22.0 (+ `@prisma/adapter-pg@7.8.0` et `pg` en `latest`, non utilisés) |
| Auth | jsonwebtoken / bcrypt / google-auth-library | 9.0.3 / 5.1.1 / 10.x |
| Sécurité | helmet 8, csrf-csrf 4.0.3, express-rate-limit 7 | — |
| Temps réel | socket.io | 4.8.3 |
| PDF | puppeteer | 21.11.0 (Chromium système en Docker) |
| Upload | multer | 1.4.5-lts.2 |
| Notifications | nodemailer 6.10.1, twilio 6, web-push 3.6, axios 1.17.0 | — |
| Stockage | @aws-sdk/client-s3 | 3.726.1 |
| Frontend | Next.js / React | **15.1.6** / 19.2.7 |
| UI | Tailwind 4, Radix UI, antd 5.28, framer-motion, Recharts, lucide | — |
| État | Zustand 5, TanStack Query 5, react-hook-form + Zod | — |
| Tests | vitest 1.6.1, supertest, @testing-library/react | — |

## Dépendances importantes et remarques
- **Redis + BullMQ + ioredis** : annoncés dans `CLAUDE.md` et déployés, mais **jamais importés** **[FAIT]**. C'est du code mort, avec une surface d'attaque inutile.
- `@prisma/adapter-pg` et `pg` en `latest` : non épinglés et non utilisés, ce qui empêche des builds reproductibles.
- `@vitest/coverage-v8` absent : le script `test:coverage` est cassé **[FAIT]**.
- `.env.example` documente MTN direct, Orange direct et `CRON_SECRET` pour une route `/api/admin/cron/monthly-statements` qui **n'existe pas** **[FAIT]**.

## Environnements et déploiement
- **Docker Compose** (`sgm-cem/docker-compose.yml`) : postgres, redis, api, web.
  - IP LAN **codée en dur** (`172.21.253.77`) dans `environment:` et `build.args`. En Compose, `environment:` est prioritaire sur `env_file` : modifier `APP_URL`/`API_URL` dans `.env`, comme le recommande `DEPLOIEMENT_DOCKER.md` §Mise en production, **n'a aucun effet** **[FAIT]**.
  - Ports publiés sur toutes les interfaces : `5433` (PostgreSQL, `postgres/postgres`) et `6379` (Redis, sans authentification) **[FAIT]**.
  - Conteneurs exécutés en **root**. `pnpm --filter api build || true` **masque les erreurs TypeScript** au build (seule la présence de `dist/index.js` est testée) **[FAIT]**.
  - L'entrypoint fait `prisma db push` (pas de migrations) et lance le seed complet (comptes démo inclus) si la base est vide.
- **Render / Netlify** (`render.yaml`, `netlify.toml`, `next.config.ts` rewrites) : le web proxifie `/api`, `/socket.io` et `/uploads` vers l'API. L'API voit alors toutes les requêtes venir de l'IP du proxy (voir V-09).
- **CI GitHub Actions** (`.github/workflows/ci.yml`) : type-check, tests API, build web, build API. Points faibles :
  - aucun seed, alors que plusieurs tests l'exigent (voir Résultats) ;
  - pnpm 9 contre lockfile v6 / pnpm 8 ;
  - ni lint, ni tests web, ni `pnpm audit`, ni build Docker ;
  - déclenchement sur `main` et `develop` uniquement.

---

# Fonctionnalités et flux détectés

| # | Flux | Objectif | Étapes clés | Fichiers / services | État | Risques et recommandations |
|---|---|---|---|---|---|---|
| F1 | Connexion e-mail / mot de passe | Accès staff et membres | CSRF → `POST /auth/login` → cookies `access_token` (15 min) et `refresh_token` (7 j) | `routes/auth.ts`, `store/authStore.ts`, `lib/api.ts` | Fonctionnel | Mots de passe par défaut (V-02). `mustChangePassword` imposé côté UI seulement. Rate-limit par IP sans proxy de confiance (V-09). |
| F2 | Connexion OTP WhatsApp / SMS | Accès sans mot de passe | `otp/request` → code 6 chiffres 5 min → `otp/verify` | `routes/auth.ts`, `services/notification.ts` | Non testable (fournisseur) | `Math.random`, code en clair, `whatsappPhone` non unique, énumération (V-15, V-16). |
| F3 | Connexion Google | Accès admin | ID token vérifié, e-mail préexistant | `routes/auth.ts`, `app/page.tsx` | Non testable (Client ID) | `email_verified` non contrôlé (faible). Route exemptée de CSRF. |
| F4 | Refresh / déconnexion / impersonation | Session | refresh sans rotation ; impersonation DEVELOPER 1 h auditée | `routes/auth.ts`, `routes/developer.ts` | Fonctionnel mais défaillant en sécurité | Compte désactivé toujours rafraîchissable (V-07). |
| F5 | Paiement Mobile Money individuel | Membre ou staff paie une rubrique | réservation verrouillée → Yelii `collect/initiate` (montant majoré 2,5 %) → webhook / polling 5 s / cron 10 min | `routes/payments.ts`, `services/yelii.service.ts`, `webhooks/yelii.webhook.ts`, `services/payment-status.service.ts`, `jobs/payment-reconciliation.ts` | Fonctionnel (non testable de bout en bout) | Initialisation incertaine → `PROCESSING` sans transaction, jamais réconciliable, nouvelles tentatives bloquées en 409 (V-12). |
| F6 | Paiement carte (CinetPay) | Paiement carte | transaction `SGM<id>` → URL de paiement → webhook x-token + `/payment/check` | `services/cinetpay.service.ts`, `webhooks/cinetpay.webhook.ts` | Fonctionnel (non testable) | Bonne vérification serveur. `fetch` sans timeout (V-26). |
| F7 | Paiement réparti multi-rubriques (lot) | Un débit pour N rubriques | `POST /payments/batches/initiate` → `PaymentBatch` + N contributions → 1 transaction fournisseur | `services/payment-batch.service.ts`, `PaymentStepper.tsx` | **Défaillant** pour Mobile Money et carte dès 2 rubriques | Jamais confirmé automatiquement (V-05). `PaymentBatch.status` jamais passé à `CONFIRMED`. |
| F8 | Déclaration espèces (double validation) | Le membre déclare, le collecteur confirme | `POST /contributions/declare` → `PATCH /:id/confirm` par le collecteur désigné → reçu | `routes/contributions.ts`, `Validations.tsx` | Fonctionnel | La confirmation ne filtre pas le mode de paiement (V-03). |
| F9 | Encaissement direct collecteur | Le collecteur saisit et confirme | `POST /contributions` (`directCollection`) | `routes/contributions.ts`, `Contributions.tsx`, `useOfflineSync.ts` | Fonctionnel | Mode libre (MTN_MOMO, VIREMENT…), file hors ligne sans idempotence (V-20). Flux Yelii hérité incohérent (V-22). |
| F10 | Litiges | Contester / résoudre | `PATCH /:id/litige` (niveau 2) → `resolve-litige` (niveau 3) | `routes/contributions.ts`, `Litiges.tsx` | Fonctionnel mais permissif | N'importe quelle contribution, sans contrôle d'état ni de propriété (V-10). |
| F11 | Chaîne des fonds | Collecteur → responsable / trésorier → banque | `POST /funds/transfer` → confirmer / refuser / annuler → `PATCH /funds/bank-deposit` ; raccourcis `/collecteurs/transfer` et `/collecteurs/claim` | `routes/funds.ts`, `routes/collecteurs.ts`, `services/borderau.ts` | Défaillant en contrôle d'accès | `claim` contourne la validation (V-04) ; `transfer` pose `EN_BANQUE` sans bordereau (V-11) ; concurrence (V-13). |
| F12 | Collectes publiques | Don anonyme via lien | vitrine → brouillon (jeton haché) → initiation Yelii / carte → polling par jeton | `routes/public.ts`, `PublicCollecteStepper.tsx`, `app/collecte/[slug]` | Fonctionnel (testé par vitest, 16 tests) | Double soumission concurrente → double débit (V-12). Nom injecté dans le PDF (V-06). |
| F13 | Reçus / bordereaux / rapport financier PDF | Justificatifs | Puppeteer `setContent` → stockage S3 ou local → URL publique `/uploads/receipts` | `services/receipt.ts`, `borderau.ts`, `financial-report.ts` | Fonctionnel (Chromium requis) | Injection HTML (V-06). Un Chromium par PDF, non fermé en cas d'erreur (V-21). Reçus publics à vie. |
| F14 | Notifications | In-app, Web Push, WhatsApp, SMS, e-mail, Socket.IO | création en base + push + 360dialog / Twilio / SMTP ; diffusion `broadcast` niveau 3 | `services/notification.ts`, `push.service.ts`, `email.ts`, `lib/socket.ts` | Non testable (clés absentes) | `broadcastToAll('contribution:confirmed')` à tous les connectés (identifiants seulement). |
| F15 | GED commissions | Documents | upload multer (20 Mo) → workflow brouillon → approuvé → archivé | `routes/commissions.ts`, `Ged.tsx` | Fonctionnel | Un MEMBRE lit et télécharge tout via l'API (V-14). MIME déclaré par le client. |
| F16 | Membres / utilisateurs / import | Annuaire | CRUD niveau 3, import JSON, gestion des utilisateurs ADMIN | `routes/membres.ts`, `users.ts` | Fonctionnel | Mots de passe par défaut (V-02). Désactivation non auditée et sans révocation (V-07). |
| F17 | Statistiques / rapports / export Excel | Pilotage | `/stats/*`, PDF, `exceljs` côté client | `routes/stats.ts`, `Rapports.tsx`, `lib/exportXlsx.ts` | Fonctionnel | Agrégations en mémoire sur toute la table (V-21). Export limité à 500 lignes côté client. |
| F18 | Panneau développeur | Configuration à chaud | config masquée, révélation auditée, test Yelii, impersonation | `routes/developer.ts`, `config.service.ts`, `Developer.tsx` | Fonctionnel (testé) | Secrets fournisseurs en clair en base (V-17). |
| F19 | Journal d'audit / observabilité | Traçabilité | `/audit` filtré par rôle ; `/activity` heartbeats | `routes/audit.ts`, `activity.ts`, `activity-write.service.ts` | Fonctionnel | `/activity/users` charge toutes les sessions et tout l'audit en mémoire (O(n×m)). Plusieurs actions sensibles non auditées (toggle-active, statut membre, couple). |
| F20 | Crons | Réconciliation, relevé mensuel, rétention | node-cron dans le processus | `jobs/`, `services/cron.ts` | Fonctionnel | Dupliqués si plusieurs instances. Alertes « bloqués > 1 h » répétées sans fin (V-29). |
| F21 | Mode hors ligne | Saisie sans réseau | IndexedDB → rejeu `POST /contributions` | `hooks/useOfflineSync.ts`, `lib/offlineQueue.ts` | Incomplet | Doublons possibles. File persistante après déconnexion sur appareil partagé. |
| F22 | Avatars | Photo de profil | `storeFile('avatars/…')` | `routes/profile.ts` | **Défaillant en stockage local** | `/uploads/avatars` n'est plus servi (seul `/uploads/receipts` l'est) ; le test `security.test.ts` échoue (V-23). |

**Fonctionnalités absentes, mortes ou simulées :**
- aucun **remboursement** ni écriture compensatoire : un litige résolu « ANNULE » sur un paiement digital ne rembourse rien et n'est pas tracé côté fournisseur ;
- **réconciliation comptable** avec le relevé du wallet Yelii : absente ;
- Redis / BullMQ : morts ; intégrations MTN et Orange directes (`.env.example`) : mortes ; route cron manuelle : inexistante ;
- flux Yelii hérité dans `POST /contributions` (champ `momoTransactionId`, polling `/contributions/:id/payment-status`) : parallèle au flux actuel, sans commission, ignoré par le webhook et la réconciliation ;
- **pas de mot de passe oublié en libre-service** pour les membres (il faut contacter l'admin) ;
- **pas de pagination** sur `/funds/transfers`, `/funds/bank-deposits` et `/users`.

**Incohérences interface / API :**
- vue `ged` : niveau ≥ 2 côté front, niveau 1 côté API ;
- vue `parametres` : niveau 5 côté front, `PATCH /settings` niveau 4 côté API ;
- les validations affichent et permettent de confirmer des contributions MTN, Orange et carte en attente ;
- `GET /contributions` est accessible à tout collecteur, toutes contributions confondues.

---

# API et intégrations externes

| Service | Usage | Fichiers concernés | Données manipulées | Secrets attendus | Erreurs / sandbox / idempotence | Risques | Recommandations |
|---|---|---|---|---|---|---|---|
| **Yelii** (MTN MoMo + Orange Money) | Collecte USSD, statut, relance de callback, solde | `services/yelii.service.ts`, `webhooks/yelii.webhook.ts`, `routes/payments.ts`, `routes/public.ts`, `payment-status.service.ts`, `jobs/payment-reconciliation.ts` | montant majoré, téléphone payeur, transactionId | `YELII_COLLECT_API_KEY` (ou `YELII_API_KEY`), `YELII_WEBHOOK_URL` | Timeout 10 s, `redirect: 'error'`, hôte figé `api.yelii.xyz` (anti-SSRF). Statut `unknown` ≠ `failed`. HMAC-SHA512 sur `timestamp + JSON.stringify(body)` avec fenêtre de 5 min. Idempotence par `updateMany` conditionnel. Pas de mode sandbox explicite. | Lots multi-rubriques jamais confirmés (V-05). Signature calculée sur le corps **re-sérialisé** : tout écart de sérialisation fait rejeter un webhook légitime [HYPOTHÈSE]. Timestamp supposé en millisecondes [HYPOTHÈSE]. Initialisation incertaine orpheline (V-12). Alerte d'incohérence répétée. Clé au format réel dans la documentation (V-17). | Comparer au total du lot et confirmer toutes les lignes atomiquement. Vérifier sur le corps brut (`express.raw`) si Yelii signe les octets. Stocker une référence locale envoyée à Yelii (`externalId`) pour retrouver une transaction après timeout. Ajouter une réconciliation quotidienne avec l'historique Yelii. |
| **CinetPay** (carte) | Initiation, vérification, webhook | `services/cinetpay.service.ts`, `webhooks/cinetpay.webhook.ts` | montant XAF multiple de 5, identité client (nom, e-mail, téléphone) | `CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_SECRET_KEY` | x-token HMAC-SHA256 en temps constant. **Statut relu via `/payment/check`** (bonne pratique). Contrôle montant et devise. | Lots (V-05). `fetch` **sans timeout**. Clé API dans le corps JSON (imposé par CinetPay). | Timeout et AbortSignal. Comparer au total du lot. Journaliser `api_response_id`. |
| **360dialog** (WhatsApp Business) | OTP, confirmations, reçus en document | `services/notification.ts` | téléphone, nom, montant, URL du reçu | `DIALOG360_API_KEY` | axios sans timeout explicite. Échec → repli SMS. | Données personnelles transmises à un tiers. Templates Meta requis en production [HYPOTHÈSE]. axios vulnérable (V-19). | Timeout. Templates validés. Consentement documenté (page confidentialité). |
| **Twilio** (SMS) | Repli OTP et notifications | `services/notification.ts` | téléphone, code OTP | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Client reconstruit si la config change | OTP en clair dans le SMS (inhérent). | Limiter par numéro, pas seulement par IP. |
| **SMTP / nodemailer** | Confirmations, relevés | `services/email.ts` | e-mail, montant | `SMTP_*` | — | nodemailer 6.10.1 : plusieurs CVE élevées (DoS addressparser). | Mettre à jour (≥ 7.0.11 au minimum, idéalement la dernière). |
| **Web Push** (VAPID) | Notifications navigateur | `services/push.service.ts`, `routes/notifications.ts` | endpoint, clés p256dh / auth | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `upsert` par endpoint (réattribution à l'utilisateur courant) | Faible. | Nettoyer les abonnements 410/404. |
| **Google Identity** | Connexion admin | `routes/auth.ts`, `app/page.tsx` | ID token, e-mail | `GOOGLE_CLIENT_ID` (+ `NEXT_PUBLIC_GOOGLE_CLIENT_ID` au build) | `verifyIdToken` avec audience | `email_verified` non vérifié. | Exiger `email_verified === true`. |
| **S3 / R2 / Supabase** | Reçus, bordereaux, GED, avatars | `services/storage.ts` | PDF nominatifs, documents | `S3_*` | Repli disque local | URL publiques permanentes. MIME déclaré par le client. fast-xml-parser (aws-sdk) critique. | URL signées à durée limitée pour reçus et GED. Mettre à jour aws-sdk. |
| **Puppeteer / Chromium** | PDF | `receipt.ts`, `borderau.ts`, `financial-report.ts` | données nominatives | `PUPPETEER_EXECUTABLE_PATH` | Un navigateur par document | Injection HTML et SSRF (V-06). Fuite de processus si erreur. tar-fs, ws et extract-zip vulnérables (chaîne puppeteer 21). | Échapper partout. `page.setRequestInterception` pour bloquer le réseau, JS désactivé, navigateur mutualisé. Puppeteer à jour. |
| **Socket.IO** | Temps réel | `lib/socket.ts`, `hooks/useSocket.ts` | identifiants de contribution | JWT (cookie) | Auth par cookie au handshake | engine.io et socket.io-parser : DoS (CVE élevées). Rôle figé au handshake. | Mettre à jour. |
| **Redis** | — (aucun usage) | `docker-compose.yml` | — | — | — | Exposé sans mot de passe. | Retirer ou sécuriser. |

**Focus paiements :**
- **Montants** : entiers en XAF, validés par Zod et `assertPositiveInt`. La commission est calculée côté serveur (taux en base, borné à [0,1[). Le montant envoyé au fournisseur est calculé par le serveur, jamais par le client **[FAIT]**.
- **Devise** : XAF imposée (CinetPay). Yelii ne renvoie pas de devise, elle est supposée.
- **Validation serveur** : contrôle de cohérence du montant à la confirmation. Exception : côté polling Yelii, si `amount` est **absent**, la contribution est confirmée quand même (`remote.amount == null || …`, `payment-status.service.ts:157-158`).
- **Signatures webhook** : correctes dans le principe (HMAC, temps constant, anti-rejeu Yelii 5 min). Il n'y a pas d'anti-rejeu côté CinetPay, ce qui est compensé par la relecture serveur.
- **Double paiement** : réservation verrouillée pour `/payments/initiate`, idempotence par clé et empreinte pour les lots. **Absent** pour l'initiation publique, où deux requêtes simultanées avec le même brouillon créent deux contributions et deux push USSD (V-12).
- **Remboursement** : inexistant.
- **Statuts** : deux champs redondants (`statut` métier + `paymentStatus` fournisseur), sources d'états incohérents. Exemple : `EN_ATTENTE_CONFIRMATION + FAILED` après une initialisation publique incertaine.
- **Fraude interne** : confirmation manuelle de paiements digitaux (V-03), litige ou annulation de paiements confirmés (V-10), raccourcis de localisation des fonds (V-04, V-11).
- **Réconciliation** : cron sur `PROCESSING` > 15 min. Ne couvre ni les contributions sans `externalTransactionId`, ni les lots.

---

# Résultats des tests

## Tests exécutés (trace)

| Commande | Résultat |
|---|---|
| `pnpm install --frozen-lockfile` (téléchargement Chromium désactivé) | OK, 16,8 s |
| `pnpm --filter api type-check` / `pnpm --filter web type-check` | **0 erreur** |
| `pnpm --filter web lint` | 0 erreur, **6 avertissements** (dépendances de hooks : `PaymentStepper.tsx:234`, `useActivityTracker.ts:245`, `Collecteurs.tsx:117`, `Dashboard.tsx:79`, `page.tsx:187`, `<img>` dans `Avatar.tsx:52`) |
| `next build` (télémétrie désactivée) | **OK**. `/dashboard` : **496 kB** de page, **849 kB** de First Load JS |
| `pnpm --filter web test` | **23/23** passent (3 fichiers) |
| `pnpm --filter api test` sur base **vide** (comme en CI) | 8 fichiers en échec au `beforeAll` (« Seed requis ») |
| `pnpm --filter api test` sur base seedée (PostgreSQL 16 local jetable) | **120/133** passent ; 13 échecs analysés ci-dessous |
| `vitest run tests/auth.test.ts tests/contributions.test.ts tests/security.test.ts` isolés | auth 5/5 et contributions 4/4 OK ; security : 1 échec réel |
| `vitest --coverage` | **impossible** : `@vitest/coverage-v8` manquant |
| `pnpm audit` | **11 critiques, 78 élevées, 65 modérées, 7 faibles** |
| Scripts de preuve `poc/proof.ts`, `poc/proof2.ts` (scratchpad, `fetch` simulé) | 5 preuves concluantes (P1–P5, voir Vulnérabilités) |
| **v2** — Application lancée en local : API (lanceur qui neutralise uniquement `express-rate-limit`), `next start` (build de production), base jetable seedée | OK |
| **v2** — `run/mobile-audit.js` (Playwright, 360×800, tactile, DPR 2) : 4 rôles (membre, collecteur, trésorier, développeur), chaque entrée de menu, plus 4 pages publiques | **56 écrans** capturés et mesurés automatiquement (débordements, cibles tactiles, libellés, tailles de police, images) |
| **v2** — `run/mobile-flows.js` : connexion (erreur, téléphone, mot de passe oublié), stepper de paiement du membre, bouton retour, rafraîchissement, formulaires collecteur, stepper public, 3G simulée | Constats UX-01 à UX-12 ; mesures 3G (voir UX-12) |
| **v2** — Migration antd v6 sur copie jetable (`antd6/`) : `tsc`, `next build`, `vitest`, `run/v6-check.js` | **OK** : 0 erreur, build OK, 23/23, 0 avertissement console ; 1 régression visuelle (voir section antd v6) |

**Analyse des 13 échecs API :**
- **7 échecs dus au rate-limit global** (429 au lieu de 401, 403 ou 200) : la suite complète dépasse 100 requêtes / 15 min depuis une seule IP. C'est une illustration directe de V-09. Isolés, ces tests passent.
- **4 échecs `developer-routes`** et **1 `push`** : ils dépendent de clés réelles en base (≥ 30 clés, secrets, VAPID) que le seed ne crée que si le `.env` les fournit. Ces tests dépendent de l'environnement de la machine du développeur.
- **1 échec réel** : `security.test.ts` attend `Cross-Origin-Resource-Policy: cross-origin` sur `/uploads/avatars/*`. Ce chemin n'est plus servi (régression, V-23).
- **Conclusion** : la CI telle qu'écrite (sans seed) **ne peut pas passer** **[FAIT]**.

## Couverture (estimation qualitative, l'outil étant absent)
- **Bien couvert** : calculs de commission, statut et initiation Yelii, service CinetPay (signature), service de config, collectes publiques (brouillons, anti-énumération), impersonation, garde-fous d'authentification des routes, traçabilité des fonds (partielle), parcours guidé.
- **Non couvert** :
  - webhooks Yelii et CinetPay de bout en bout ;
  - **lots multi-rubriques avec confirmation** (le bug V-05 serait détecté) ;
  - confirmation manuelle par mode, litiges, `claim`, `/collecteurs/transfer`, dépôt bancaire ;
  - refresh, désactivation, OTP ;
  - GED, upload, import de membres, stats, reçus PDF (Chromium absent en CI) ;
  - concurrence, crons ;
  - front : 3 composants seulement, aucune vue, aucun test E2E.

## Limites rencontrées (ce qui n'a PAS été testé et pourquoi)
- **Paiements réels et sandbox Yelii / CinetPay** : aucune clé sandbox fournie, et interdiction d'effectuer des transactions. Les flux ont été simulés avec `fetch` mocké.
- **WhatsApp, SMS, e-mail, Web Push, Google** : pas de clés, et interdiction d'envois réels.
- **Génération PDF réelle** : Chromium non installé (téléchargement désactivé volontairement). L'injection est prouvée au niveau du HTML transmis à Chromium, **pas** l'exécution SSRF elle-même.
- **Docker Compose** : non lancé (pas de démon Docker actif ; risque d'action sur des volumes). Les constats Docker sont issus de la lecture.
- **UI / responsive / E2E navigateur** : **réalisés en v2** dans Chromium (Playwright) en émulation mobile, pas sur un appareil physique iOS ou Android. Le comportement du clavier virtuel, des encoches, d'iOS Safari et de l'installation PWA réelle n'a pas été observé. Les paiements n'ont pas été soumis (aucun appel fournisseur). Les vues sans données de démonstration (GED, prestations) n'ont été vues qu'à l'état vide.
- **Accessibilité** : mesures automatiques maison (cibles, libellés, tailles, images), mais **pas d'audit axe-core ou Lighthouse complet**, et pas de test avec lecteur d'écran (TalkBack, VoiceOver).
- La bannière de notifications push apparaît en mode « bloquées » parce que Chromium headless refuse la permission par défaut. Sur un vrai téléphone, l'état initial affiche plutôt le bouton « Activer ». Le constat UX-06 couvre les deux états.
- Une erreur console `403` à chaque session vient du script Google Identity, bloqué par le proxy de l'environnement d'audit. C'est un artefact, pas un défaut de l'application.
- Comportement en production derrière HTTPS / proxy (cookies `Secure`, `trust proxy`) : déduit du code, non observé.
- Une requête de télémétrie anonyme de Next.js est partie lors du premier `next lint`, avant que je la désactive. Elle ne contient pas de données du projet.

---

# Vulnérabilités et défauts

### V-01 — Next.js 15.1.6 et dépendances runtime vulnérables
- **Gravité : Critique**
- **Description :** `next@15.1.6` est concerné, selon `pnpm audit`, par :
  - une RCE non authentifiée dans le protocole React Flight (corrigée en 15.1.9) ;
  - une RCE via l'optimiseur d'images AVIF (< 15.5.24) ;
  - plusieurs DoS liés aux Server Components ;
  - des SSRF dans les rewrites, alors que ce projet utilise des rewrites vers l'API ;
  - CVE-2025-29927 (contournement de middleware : non exploitable ici, il n'y a pas de `middleware.ts`).

  D'autres dépendances runtime sont vulnérables : `socket.io`/`engine.io` (DoS), `axios` 1.17 (SSRF via redirection, pollution de prototype), `nodemailer` 6.10 (DoS, CVE-2025-14874…), `fast-xml-parser` via aws-sdk (critique), `proxy-addr` (critique, peu exploitable sans `trust proxy`), `tar-fs`, `ws` et `extract-zip` via puppeteer 21.
- **Impact :** prise de contrôle du serveur web, déni de service.
- **Emplacement :** `apps/web/package.json` (`next: 15.1.6`), `apps/api/package.json`, `pnpm-lock.yaml`.
- **Preuve :** sortie `pnpm audit` (« critical next >=15.1.0-canary.0 <15.1.9 — RCE in React flight protocol », « critical next <15.5.24 — Unauthenticated RCE in Image Optimization API »).
- **Correctif :** passer Next à ≥ 15.5.24 (et `eslint-config-next` en cohérence), mettre à jour socket.io, axios, nodemailer, aws-sdk et puppeteer. Ajouter `pnpm audit --prod --audit-level=high` en CI, avec Dependabot ou Renovate.
- **Effort :** moyen.

### V-02 — Identifiants par défaut versionnés, sans changement imposé côté serveur
- **Gravité : Critique**
- **Description :**
  - `prisma/seed.ts` crée, si la base est vide (lancé automatiquement par `docker-entrypoint.sh`), un admin et 5 comptes staff (trésorier, responsable, adjoint, 2 collecteurs) plus 20 membres démo. Ils partagent le mot de passe commun inscrit dans le seed et dans `DEPLOIEMENT_DOCKER.md`, avec `mustChangePassword: false`. L'admin reprend ce même mot de passe si `ADMIN_PASSWORD` n'est pas défini.
  - `routes/users.ts` (`DEFAULT_PASSWORD`) et `routes/membres.ts` (création et import) utilisent aussi des mots de passe par défaut codés en dur.
  - `mustChangePassword` n'est **appliqué que par le front** (`app/(app)/layout.tsx`) : un client API l'ignore.
- **Impact :** prise de contrôle immédiate d'un compte TRÉSORIER (dépôts bancaires, paramètres, collectes), de collecteurs et de membres. Des données démo se retrouvent en production.
- **Emplacement :** `apps/api/prisma/seed.ts:23,53-54,459-463` ; `routes/users.ts:12` ; `routes/membres.ts` (POST `/` et `/import`) ; `docker-entrypoint.sh` (seed conditionnel).
- **Preuve [PREUVE] :** sur la base seedée, tous les rôles ont `mustChangePassword = f`, et le hash du trésorier correspond au mot de passe versionné (`bcrypt.compare` → `true`).
- **Correctif :**
  - séparer `seed-prod` (admin seul, mot de passe aléatoire affiché une fois ou fourni par variable obligatoire) et `seed-demo` (jamais en production) ;
  - mots de passe temporaires aléatoires (`crypto.randomBytes`) ;
  - middleware serveur qui refuse toute route hors `change-password` / `me` / `logout` tant que `mustChangePassword` vaut vrai ;
  - retirer le mot de passe de la documentation et faire tourner les mots de passe des environnements existants.
- **Effort :** faible.

### V-03 — Confirmation manuelle de paiements digitaux non encaissés
- **Gravité : Élevé**
- **Description :** `PATCH /api/contributions/:id/confirm` (niveau ≥ 2) confirme toute contribution `EN_ATTENTE_CONFIRMATION`, quel que soit `modePaiement`, et force `paymentStatus: SUCCESS`. Un collecteur peut le faire sur les contributions dont il est `collecteurId` ; c'est le cas de tout paiement digital qu'il a initié via `/payments/initiate`. Un RESPONSABLE ou plus peut le faire sur toutes. La vue `Validations.tsx` affiche ces lignes avec un bouton « Confirmer ». En complément, `POST /api/contributions` accepte n'importe quel mode (`MTN_MOMO`, `CARTE_VISA`, `VIREMENT`…) et des champs libres (`collecteurId`, `referencePaiement`).
- **Impact :** reçus officiels et soldes « payés » sans encaissement réel. Le webhook ultérieur est ignoré (garde d'idempotence), et la comptabilité est faussée.
- **Emplacement :** `routes/contributions.ts:420-454` et `:215-292`.
- **Preuve [PREUVE P4] :** contribution `MTN_MOMO` en `PROCESSING` (transaction jamais payée) confirmée par son collecteur → `HTTP 200`, `statut=CONFIRME`, `paymentStatus=SUCCESS`, et tentative de génération de reçu.
- **Correctif :**
  - n'autoriser la confirmation manuelle que pour `ESPECES` et `VIREMENT` ;
  - pour les modes digitaux, seuls webhook, polling ou réconciliation confirment, ou un trésorier via un flux « forcer » distinct, motivé, audité et vérifié auprès du fournisseur ;
  - restreindre `POST /contributions` aux modes non digitaux, avec `collecteurId` forcé à l'appelant pour un COLLECTEUR ;
  - écriture conditionnelle (`updateMany where statut`).
- **Effort :** faible.

### V-04 — Interception de fonds en transit via `/collecteurs/claim`
- **Gravité : Élevé**
- **Description :** tout rôle de niveau ≥ 2 peut « réceptionner » n'importe quelle contribution `EN_TRANSIT`. Il n'y a de contrôle ni du destinataire du `FundsTransfer`, ni du `statut` (des contributions digitales en attente sont aussi `EN_TRANSIT`). L'appelant devient `collecteurId` et la localisation passe à `CHEZ_COLLECTEUR` (ou `EN_CAISSE`). Le transfert reste `PENDING_APPROVAL`. Combiné à V-03, un collecteur peut s'approprier puis confirmer des contributions d'autrui.
- **Impact :** traçabilité des espèces compromise ; détournement possible sans validation du destinataire (RB-23 contournée).
- **Emplacement :** `routes/collecteurs.ts:233-297`.
- **Preuve [PREUVE P3] :** collecteur 1 → transfert vers le trésorier (200) ; collecteur 2 (tiers) → `claim` → `HTTP 200`, `collecteurId=col2`, `localisation=CHEZ_COLLECTEUR`, transfert toujours `PENDING_APPROVAL`.
- **Correctif :** supprimer `claim` ou le limiter aux contributions dont le `FundsTransfer` en attente a `receiverId = appelant`, avec `statut = CONFIRME`, et clore le transfert dans la même transaction. Utiliser le Zod `claimSchema` (déclaré mais inutilisé).
- **Effort :** faible.

### V-05 — Les lots multi-rubriques (Mobile Money et carte) ne sont jamais confirmés automatiquement
- **Gravité : Élevé**
- **Description :** depuis `7a19123`/`8b66fad`, chaque ligne d'un lot porte le même `externalTransactionId`. Mais webhook, polling et réconciliation comparent le montant renvoyé par le fournisseur (le **total** du lot) au montant de **la ligne** (`amountChargedToPayer` pour Yelii, `montant` pour CinetPay). Dès 2 rubriques, l'écart est systématique : alerte « Montant incohérent » et statut bloqué. Le webhook ne traite en plus qu'une ligne (`findFirst`). `PaymentBatch.status` ne passe jamais à `CONFIRMED`.
- **Impact :** paiements réellement débités affichés comme « en attente » ; membres relancés à tort ; alertes trésorier ; tentation de confirmer manuellement (V-03).
- **Emplacement :** `services/payment-status.service.ts:151-191`, `webhooks/yelii.webhook.ts:81-102`, `webhooks/cinetpay.webhook.ts:113-150`.
- **Preuve [PREUVE P1] :** lot 1 000 + 2 000 FCFA → `totalToPay=3077`, lignes `1026` et `2051`. Yelii simulé « success » avec 3 077 → les deux lignes restent `EN_ATTENTE_CONFIRMATION`, avec le log « 1026 XAF attendus, 3 077 FCFA reçus ».
- **Correctif :** si la contribution a un `paymentBatchId`, comparer au total du lot (`totalAllocated + commissions`), puis confirmer **toutes** les lignes et le lot dans une seule transaction conditionnelle. Le webhook doit itérer sur toutes les lignes. Ajouter un test de non-régression.
- **Effort :** moyen.

### V-06 — Injection HTML dans les PDF générés par Chromium côté serveur
- **Gravité : Élevé**
- **Description :** `receipt.ts`, `borderau.ts` et `financial-report.ts` interpolent sans échappement des noms (dont `contributeurExterne.nom`, saisi **sans authentification** sur la page publique), des téléphones, `periodeLabel`, des titres de rubrique… Le HTML est rendu par `page.setContent(html, { waitUntil: 'networkidle0' })` avec JavaScript actif, réseau autorisé et `--no-sandbox`. La fonction `escapeHtml` existe dans `pdf-branding.ts` mais n'est appliquée qu'à l'en-tête.
- **Impact :** SSRF depuis le conteneur API vers le réseau interne ou les métadonnées cloud (requêtes aveugles), falsification du contenu des reçus et rapports, DoS via des ressources lourdes. Côté public, un paiement (même minime) doit aboutir pour déclencher la génération.
- **Emplacement :** `services/receipt.ts:151-186`, `services/borderau.ts:45-46`, `services/financial-report.ts:41,169`.
- **Preuve [PREUVE P2] :** un nom `<img src="http://169.254.169.254/poc">Jean` se retrouve tel quel dans le HTML transmis à Chromium (`true`). L'exécution réseau n'a pas été observée faute de Chromium.
- **Correctif :** `escapeHtml` systématique (ou moteur de templates à échappement automatique) ; `page.setJavaScriptEnabled(false)` et `setRequestInterception` qui bloque toute requête sauf `data:` ; retirer `--no-sandbox` si possible (utilisateur non-root) ; validation stricte du nom public (lettres, espaces, tirets).
- **Effort :** faible.

### V-07 — Sessions non révoquées (désactivation, changement de mot de passe, rôle)
- **Gravité : Élevé**
- **Description :**
  - `/auth/refresh` ne vérifie pas `user.isActive` ;
  - `toggle-active` ne supprime pas les `UserSession` et n'est pas audité ;
  - `change-password` n'invalide pas les autres sessions ;
  - le refresh token n'est pas renouvelé (pas de rotation) ;
  - l'access JWT (15 min, 1 h en impersonation) n'est jamais revérifié en base (rôle et activité).
- **Impact :** un collecteur ou un trésorier révoqué garde l'accès jusqu'à 7 jours ; un vol de refresh token reste valable 7 jours.
- **Emplacement :** `routes/auth.ts:384-409`, `routes/users.ts:145-161`, `routes/auth.ts:343-381`, `middleware/auth.ts`.
- **Preuve [PREUVE P5] :** session créée, compte passé `isActive=false` → `POST /auth/refresh` → `HTTP 200` et nouveau cookie `access_token`.
- **Correctif :** vérifier `isActive` au refresh ; `deleteMany` des sessions à la désactivation, au changement ou à la réinitialisation de mot de passe et au changement de rôle ; rotation du refresh token avec détection de réutilisation ; audit de `toggle-active`.
- **Effort :** faible.

### V-08 — Exposition de PostgreSQL et Redis, conteneurs en root
- **Gravité : Élevé**
- **Description :** `docker-compose.yml` publie `5433:5432` (identifiants `postgres/postgres`) et `6379:6379` (Redis sans mot de passe, inutilisé) sur toutes les interfaces. Les Dockerfiles n'ont pas de `USER`. `DATABASE_URL` est codé en dur dans `environment:`.
- **Impact :** sur un VPS, la base est accessible depuis Internet avec des identifiants triviaux (lecture et modification de toutes les données et de tous les secrets en base), et Redis est exploitable (écriture de fichiers).
- **Emplacement :** `sgm-cem/docker-compose.yml` (services postgres, redis, api), `apps/*/Dockerfile`.
- **Preuve :** lecture de la configuration **[FAIT]**. Non lancé.
- **Correctif :** supprimer les `ports:` de postgres et redis (ou lier à `127.0.0.1`), mot de passe fort via `.env`, retirer Redis, `USER node`, système de fichiers en lecture seule hors `uploads`.
- **Effort :** faible.

### V-09 — Rate-limit global par IP et absence de `trust proxy`
- **Gravité : Élevé (disponibilité)**
- **Description :**
  - limite de 100 requêtes / 15 min / IP sur **toute** l'API (`index.ts`), alors que l'application polle (validations toutes les 30 s, statut de paiement toutes les 5 s, heartbeats d'activité, notifications) ;
  - `app.set('trust proxy', …)` a été retiré (commit `66960b7`) ;
  - derrière le proxy Next/Render/Netlify ou un reverse proxy Caddy, tous les utilisateurs partagent l'IP du proxy, donc un seul quota de 100 requêtes ;
  - la limite de login est de 15/h par IP, elle aussi partagée.
- **Impact :** application inutilisable dès quelques utilisateurs simultanés ; blocage des connexions de tous par un seul attaquant. `req.secure` est aussi faux derrière un proxy (cookies non `Secure` sauf via l'en-tête `x-forwarded-proto` lu manuellement).
- **Emplacement :** `apps/api/src/index.ts:72-73`, `routes/auth.ts:33-36`.
- **Preuve [FAIT] :** la suite de tests complète reçoit des **429** à partir de la 100ᵉ requête (7 tests en échec pour cette seule raison).
- **Correctif :** `app.set('trust proxy', 1)` (nombre exact de sauts) ; limites par utilisateur authentifié (clé = `userId`) pour les routes connectées ; limites strictes par IP **et** par identifiant (e-mail, téléphone) pour login et OTP ; exclure les heartbeats du quota global ou les rendre moins fréquents ; store partagé (Redis) si plusieurs instances.
- **Effort :** faible.

### V-10 — Mise en litige et annulation de toute contribution
- **Gravité : Moyen**
- **Description :** `PATCH /contributions/:id/litige` (niveau 2) n'a ni contrôle de propriété ni contrôle d'état : un collecteur peut placer en litige une contribution **confirmée** d'un autre collecteur, ou un paiement digital. Un RESPONSABLE la résout ensuite en `ANNULE` sans mise à jour de `paymentStatus` ni remboursement. Un identifiant inexistant provoque une 500 (P2025).
- **Impact :** effacement comptable de paiements réels ; nuisance entre collecteurs.
- **Emplacement :** `routes/contributions.ts:456-475`, `:477-524`.
- **Correctif :** limiter aux contributions `EN_ATTENTE_CONFIRMATION` (ou `CONFIRME` par TRÉSORIER+ avec motif) ; collecteur limité à ses contributions ; annulation d'un paiement digital confirmé = procédure de remboursement tracée.
- **Effort :** faible.

### V-11 — `/collecteurs/transfer` permet de poser `EN_BANQUE` ou `EN_CAISSE` sans dépôt
- **Gravité : Moyen**
- **Description :** un RESPONSABLE (niveau 3) peut passer des contributions `CHEZ_COLLECTEUR` ou `EN_TRANSIT` directement en `EN_BANQUE`, sans `BankDeposit` ni bordereau. Cela contourne la règle B6, réservée au trésorier.
- **Impact :** fonds déclarés « en banque » sans preuve.
- **Emplacement :** `routes/collecteurs.ts:11-15,182-231`.
- **Correctif :** retirer `EN_BANQUE` (et probablement tout l'endpoint, redondant avec `/funds/transfer`) ; imposer le flux de dépôt bancaire.
- **Effort :** faible.

### V-12 — Initiations de paiement : double débit et paiements orphelins
- **Gravité : Moyen**
- **Description :**
  - **Collecte publique** : la vérification `draft.contributionId` n'est pas atomique. Deux requêtes simultanées (double clic, nouvelle tentative réseau) créent deux contributions et déclenchent **deux USSD** ;
  - **collecte publique, Yelii incertain** (timeout) : la contribution passe `paymentStatus: FAILED` sans `externalTransactionId`. Si le débit a eu lieu, le webhook ne retrouve rien et l'argent n'est pas tracé ;
  - **membre, Yelii incertain** : la contribution passe `PROCESSING` sans transaction. La réconciliation l'ignore (`externalTransactionId not null`), et toute nouvelle tentative au même montant renvoie 409 « en cours » **indéfiniment** ;
  - **CinetPay individuel** : la contribution passe `PROCESSING` avant l'appel. En cas d'échec, l'URL reste nulle et la contribution est « bloquée » sans fin.
- **Emplacement :** `routes/public.ts:273-439`, `routes/payments.ts:236-358`.
- **Correctif :** réservation atomique du brouillon (`updateMany where contributionId IS NULL` ou contrainte unique, avant l'appel fournisseur) ; transmettre à Yelii une référence locale (`externalId`) pour retrouver la transaction après timeout ; état explicite `INITIATION_INCERTAINE` traité par la réconciliation, avec expiration.
- **Effort :** moyen.

### V-13 — Conditions de course sur la chaîne des fonds
- **Gravité : Moyen**
- **Description :** `confirm`, `refuse` et `cancel` d'un transfert font une lecture puis une mise à jour non conditionnelle : un confirmer et un annuler simultanés peuvent réussir tous les deux. `POST /funds/transfer` : deux transferts simultanés des mêmes contributions sont possibles (le second écrase `transferId`, le premier garde un `totalAmount` faux). `bank-deposit` n'est pas transactionnel (dépôt créé, puis mise à jour séparée) et deux dépôts concurrents sont possibles. `confirm` d'une contribution : double reçu possible.
- **Emplacement :** `routes/funds.ts:122-227,286-500,587-664`, `routes/contributions.ts:420-454`.
- **Correctif :** `updateMany` conditionnel (statut et localisation attendus) dans une transaction, avec vérification de `count` ; transaction unique pour le dépôt.
- **Effort :** moyen.

### V-14 — GED lisible par tout membre via l'API
- **Gravité : Moyen**
- **Description :** `GET /commissions/documents`, `/:id/documents` et `/documents/:id/download` sont au niveau 1 (MEMBRE), tous statuts confondus (brouillons, rejetés). Le front limite la vue au niveau 2. Le type MIME est celui déclaré par le client.
- **Emplacement :** `routes/commissions.ts:64-109`.
- **Correctif :** niveau 2 minimum, ou filtrer `statut = APPROUVE` pour les membres. Vérifier le type réel (magic bytes).
- **Effort :** faible.

### V-15 — Énumération et divulgation via « mot de passe oublié » et OTP
- **Gravité : Moyen**
- **Description :** `POST /auth/forgot-password` (non authentifié) indique si un e-mail appartient à un ADMIN ou DEVELOPER (`method: 'google'`) et **divulgue le nom, l'e-mail et le téléphone de l'administrateur** à quiconque. `otp/request` renvoie des messages différents selon que le numéro existe ou non.
- **Emplacement :** `routes/auth.ts:147-185,205-233`.
- **Correctif :** réponse identique pour tous ; contact générique (pas de données personnelles de l'admin) ; même message OTP.
- **Effort :** faible.

### V-16 — Robustesse OTP
- **Gravité : Moyen**
- **Description :** code généré par `Math.random()` (non cryptographique) et stocké en clair ; limitation par IP seulement (5 / 10 min) et non par numéro ; `whatsappPhone` non unique et recherche `findFirst` non déterministe entre `phone` et `whatsappPhone`, sur lesquels chaque utilisateur a la main via `PATCH /profile`. Le code OTP est écrit dans les logs hors production (`NODE_ENV !== 'production'` : vrai en local, faux dans le Compose).
- **Emplacement :** `routes/auth.ts:187-294`, `routes/profile.ts:44-93`.
- **Correctif :** `crypto.randomInt`, hachage du code, limite par numéro, unicité normalisée E.164 des deux champs, vérification par OTP de tout changement de numéro.
- **Effort :** moyen.

### V-17 — Secrets fournisseurs en clair (base, documentation)
- **Gravité : Moyen**
- **Description :** clés Yelii, CinetPay, S3, SMTP, Twilio, 360dialog et VAPID stockées **en clair** dans `system_configs` et révélables via le panneau développeur. `docs/reference/PAYMENT_FLOWS_SGM_CEM.md` contient, à 3 endroits (dont la ligne 64), une valeur `YELII_API_KEY` au **format d'une vraie clé** (introduite au commit `aecc4d0`). Si elle est réelle, elle est compromise (dépôt et historique).
- **Correctif :** **faire tourner cette clé Yelii si elle est réelle** et la remplacer dans la doc ; chiffrer les valeurs `isSecret` au repos (AES-GCM avec clé en variable d'environnement) ; limiter la révélation (ré-authentification).
- **Effort :** moyen.

### V-18 — CSRF : secret par défaut et cookie `Secure` sur HTTP
- **Gravité : Moyen**
- **Description :** `CSRF_SECRET` retombe sur une valeur codée en dur, **sans contrôle en production** (contrairement aux secrets JWT). Le cookie `csrf_token` est `Secure` dès que `NODE_ENV=production`, or le Compose sert en HTTP sur une IP LAN : les navigateurs refusent alors les cookies `Secure` hors HTTPS (sauf `localhost`) **[HYPOTHÈSE à vérifier]**, ce qui donnerait des 403 CSRF sur toutes les écritures.
- **Emplacement :** `apps/api/src/index.ts:76-89`.
- **Correctif :** exiger `CSRF_SECRET` (≥ 32 caractères) en production ; dériver `secure` du protocole réel ; servir en HTTPS.
- **Effort :** faible.

### V-19 — Dépendances : vulnérabilités élevées hors Next
- **Gravité : Moyen** (voir V-01 pour les critiques)
- **Description :** 78 « high » : socket.io / engine.io, axios, nodemailer, form-data, tar-fs, ws, extract-zip, sharp, postcss… Plusieurs ne concernent que le développement (vitest, tinypool, shell-quote via concurrently, tar via bcrypt).
- **Correctif :** mises à jour groupées ; séparer l'audit runtime (`--prod`) et l'audit dev.
- **Effort :** moyen.

### V-20 — File hors ligne sans idempotence
- **Gravité : Moyen**
- **Description :** `useOfflineSync` rejoue `POST /contributions` sans clé d'idempotence. Une réponse perdue ou deux onglets aboutissent à des contributions **en double**, potentiellement confirmées (`directCollection`). La file IndexedDB n'est pas purgée à la déconnexion.
- **Emplacement :** `apps/web/src/hooks/useOfflineSync.ts:22-48`.
- **Correctif :** UUID client par élément, contrainte unique côté serveur, verrou inter-onglets (BroadcastChannel / Web Locks), purge à la déconnexion.
- **Effort :** moyen.

### V-21 — Performance et robustesse serveur
- **Gravité : Moyen**
- **Description :**
  - **23 instances `new PrismaClient()`**, chacune avec son pool : saturation des connexions PostgreSQL ;
  - un Chromium lancé par PDF, sans `finally { browser.close() }` : fuite de processus en cas d'erreur ;
  - `/stats`, `/collecteurs` et `/activity/users` chargent des tables entières en mémoire (O(n×m)) ;
  - `GET /funds/transfers`, `/bank-deposits` et `/users` ne sont pas paginés ;
  - crons in-process dupliqués si plusieurs instances.
- **Correctif :** singleton `getPrisma()` partout ; navigateur mutualisé avec `try/finally` ; agrégations SQL (`groupBy`, `$queryRaw`) ; pagination ; verrou de leader pour les crons.
- **Effort :** moyen.

### V-22 — Flux Yelii hérité dans `POST /contributions`
- **Gravité : Faible**
- **Description :** le mode `YELII` déclenche `requestYelii` **sans commission**, stocke `momoTransactionId` (et non `externalTransactionId`) et passe la contribution à `ANNULE` en cas d'échec, y compris incertain. Seul le polling hérité `/contributions/:id/payment-status` le confirme, sans contrôle de montant et sans reçu.
- **Correctif :** supprimer ce chemin et rediriger vers `/payments/initiate`.
- **Effort :** faible.

### V-23 — Avatars non servis en stockage local (régression)
- **Gravité : Faible**
- **Description :** `index.ts` ne sert plus que `/uploads/receipts`, alors que `profile.ts` produit des URL `/uploads/avatars/…`. L'extension vient du nom de fichier client.
- **Preuve :** `tests/security.test.ts` échoue.
- **Correctif :** route dédiée pour les avatars (avec CORP `cross-origin`), extension dérivée du type réel.
- **Effort :** faible.

### V-24 — Contrat d'API incohérent
- **Gravité : Faible**
- **Description :** plusieurs réponses ne respectent pas `{ success:false, error:{code,message} }` : `public.ts` (`error: 'chaîne'`), `payments.ts` (`retry-webhook`), `middleware/validation.ts` (sans `success`), `membres/:id` (404 inline). Les statuts Zod (`statut as never`) ne sont pas validés, ce qui donne des 500. Certains messages sont en français sans accents (« fermee », « confirmee »).
- **Correctif :** passer partout par `AppError` ; Zod sur toutes les requêtes ; relecture des libellés.
- **Effort :** faible.

### V-25 — Signature webhook Yelii sur corps re-sérialisé
- **Gravité : Faible**
- **Description :** HMAC calculé sur `JSON.stringify(req.body)` et non sur les octets reçus. Si Yelii signe le corps brut, tout écart (ordre des clés, échappement unicode, formatage des nombres) fait rejeter des webhooks légitimes. Le timestamp est supposé en millisecondes **[HYPOTHÈSE]**.
- **Correctif :** valider avec la documentation et un webhook sandbox réel ; conserver le corps brut (`express.raw` + `verify`).
- **Effort :** faible.

### V-26 — Appels sortants sans timeout
- **Gravité : Faible**
- **Description :** CinetPay (`fetch`), 360dialog (axios) et SMTP : pas de délai d'expiration. Une requête peut rester pendante.
- **Correctif :** `AbortSignal.timeout(10_000)` et `timeout` axios.
- **Effort :** faible.

### V-27 — En-têtes de sécurité du frontend absents
- **Gravité : Faible**
- **Description :** `next.config.ts` ne définit ni CSP, ni `frame-ancestors` / `X-Frame-Options`, ni HSTS, ni `Referrer-Policy`. `images.domains` est déprécié.
- **Correctif :** `headers()` avec une CSP stricte (nonces), anti-iframe, HSTS une fois en HTTPS.
- **Effort :** faible.

### V-28 — Collecte publique : intégrité des données
- **Gravité : Faible**
- **Description :** un brouillon n'est pas lié au slug de la collecte lors de l'initiation (brouillon de la collecte A utilisable pour la collecte B). `contributeurExterne` est retrouvé par téléphone, et son nom et son e-mail sont **écrasés** par n'importe quel donateur saisissant ce numéro.
- **Emplacement :** `routes/public.ts:273-330`.
- **Correctif :** vérifier `draft.collecteId === collecte.id` ; ne pas écraser l'identité existante.
- **Effort :** faible.

### V-29 — Réconciliation : alertes en boucle
- **Gravité : Faible**
- **Description :** les contributions `PROCESSING` > 1 h déclenchent une alerte trésorier **à chaque passage** (toutes les 10 min, sans fin). L'anti-doublon `mismatchAlerted` est en mémoire et perdu à chaque redémarrage.
- **Correctif :** état « alerté » persistant, expiration et passage en `LITIGE` après N heures.
- **Effort :** faible.

### V-30 — Petits défauts fonctionnels
- **Gravité : Faible**
- **Description :**
  - notification « Transfert confirmé » : affiche le nom de l'expéditeur au lieu du destinataire (`funds.ts`, `receiverName: transfer.sender.fullName`) ;
  - `refuse` et `cancel` ne nettoient pas `transferId` ;
  - `montantAttendu = montant` pour les déclarations ;
  - le nom du membre est remplacé par son e-mail dans la notification au collecteur ;
  - la création de `memberId` par `count()+1` provoque des collisions concurrentes (`users.ts`).
- **Effort :** faible.

### V-31 — Chaîne de build et CI peu fiables
- **Gravité : Information**
- **Description :**
  - `|| true` sur `tsc` dans le Dockerfile API ;
  - CI sans seed (échec certain) et avec pnpm 9 au lieu de 8 ;
  - pas de lint, de tests web, d'audit ni de build Docker en CI ;
  - outil de couverture absent ;
  - documentation divergente : Redis/BullMQ, MTN/Orange directs, `CRON_SECRET`, IP figée dans le Compose ;
  - deux PostgreSQL sur la machine de développement (`DEPLOIEMENT_DOCKER.md` §8bis) : les tests écrivent dans une base de dev réelle.
- **Correctif :** voir Plan de tests.
- **Effort :** faible.

---

# Améliorations proposées

## Correctifs urgents (avant exposition publique)
1. Mise à jour de Next.js et des dépendances runtime critiques ou élevées (V-01, V-19).
2. Seed de production sans comptes démo ; mots de passe aléatoires ; `mustChangePassword` imposé côté serveur ; rotation des mots de passe existants (V-02).
3. Verrouillage de la confirmation manuelle aux espèces et virements ; suppression ou restriction de `claim` et de `/collecteurs/transfer` ; contrôle d'état sur les litiges (V-03, V-04, V-10, V-11).
4. Correction de la confirmation des lots et backfill des lots existants (V-05).
5. Échappement HTML et isolation réseau de Puppeteer (V-06).
6. Révocation des sessions et contrôle `isActive` au refresh (V-07).
7. Fermeture des ports base et Redis, mots de passe forts, conteneurs non-root (V-08).
8. `trust proxy` et rate-limit par utilisateur (V-09).
9. Rotation de la clé Yelii présente dans la documentation, si elle est réelle (V-17).

## Améliorations court terme (1–4 semaines)
- Atomicité et idempotence : brouillons publics, transferts, dépôts, confirmation (V-12, V-13).
- Référence locale transmise à Yelii et état `INITIATION_INCERTAINE` réconcilié (V-12).
- Unifier les statuts (`statut` et `paymentStatus`) dans une machine à états explicite (transitions autorisées par rôle et par mode).
- Corriger le contrat d'API, les messages, la pagination et les timeouts (V-24, V-26, V-21).
- GED réservée au niveau 2 ou aux documents approuvés ; « mot de passe oublié » non divulgateur ; OTP renforcé (V-14 à V-16).
- Audit systématique : désactivation, statut membre, couple, dépôt, litige ; un seul helper `audit()` (aujourd'hui `prisma.auditLog.create` est appelé directement à plus de 20 endroits).

## Améliorations long terme
- **Grand livre comptable** : écritures immuables (débit / crédit par localisation de fonds) plutôt que des mutations du champ `localisationFonds`. Rapprochement quotidien automatique avec le relevé du wallet Yelii et CinetPay.
- **Remboursements et annulations** tracés (contre-écriture, motif, validation à deux).
- **Migrations Prisma** versionnées (`migrate deploy`) à la place de `db push` en production. Sauvegardes `pg_dump` planifiées et testées.
- **File de tâches** (BullMQ, Redis enfin utilisé) pour PDF, notifications, webhooks et crons, avec reprises et idempotence. Cela retire Chromium du chemin de requête HTTP.
- Chiffrement des secrets au repos ; journalisation structurée (pino) avec masquage des données personnelles ; supervision (Sentry, métriques).
- Politique de conservation et de minimisation des données personnelles (reçus publics à durée limitée, URL signées).

## Refactoring et architecture cible
```
apps/api/src
 ├─ domain/          (machine à états Contribution / Lot / Transfert, règles RBAC par action)
 ├─ application/     (cas d'usage : initierPaiement, confirmerPaiement, transférerFonds…)
 ├─ infrastructure/  (prisma singleton, yelii, cinetpay, storage, pdf-worker, notifier)
 ├─ http/            (routes minces : Zod in/out → cas d'usage → AppError)
 └─ jobs/            (BullMQ : réconciliation, PDF, notifications, relevés)
```
- Une **politique d'autorisation centralisée** (`can(user, action, resource)`) testée unitairement, plutôt que des `requireLevel` dispersés et des tests de rôle inline.
- Partager les schémas Zod entre API et web via `@sgm-cem/shared` (contrat unique).
- Supprimer le code mort : flux Yelii hérité, Redis, `@prisma/adapter-pg`, intégrations MTN et Orange directes.

## Plan de tests recommandé
1. **CI corrigée** : seed de test dédié (fixtures), pnpm 8, désactivation du rate-limit en `NODE_ENV=test` (ou store mémoire réinitialisé), `@vitest/coverage-v8` avec un seuil (≥ 60 % sur `services/` et `routes/payments|funds|contributions`), lint web, tests web, `pnpm audit --prod`, build Docker.
2. **Tests de non-régression des vulnérabilités** : un test par V-03, V-04, V-05, V-07, V-10, V-11, V-14. Les scripts de preuve P1–P5 sont réutilisables tels quels.
3. **Webhooks** : signature valide, invalide, expirée ; rejeu ; montant incohérent ; lot ; ordre webhook contre polling ; panne de base pendant le traitement.
4. **Concurrence** : `Promise.all` de doubles initiations publiques, doubles confirmations, confirmer et annuler un transfert, doubles dépôts.
5. **Pannes réseau** : timeouts Yelii et CinetPay (`fetch` mocké), état incertain, reprise par la réconciliation.
6. **Sécurité** : matrice RBAC générée (rôle × route × attendu) ; tests IDOR (ressource d'un autre collecteur ou membre) ; CSRF ; échappement des PDF.
7. **E2E Playwright** (Chromium préinstallé) avec fournisseurs simulés : connexion, changement de mot de passe forcé, paiement guidé MoMo (succès, échec, timeout), lot, collecte publique avec reprise de brouillon, déclaration espèces puis validation, transfert puis bordereau, dépôt bancaire. Viewports 360 px, 768 px et 1280 px ; contrôle axe-core.
8. **Sandbox réels** Yelii et CinetPay en préproduction, avec un webhook reçu via HTTPS public.

## Améliorations UI/UX
Voir la section dédiée **« Audit UI/UX mobile-first et frontend »** (constats UX-01 à UX-17, maquette cible par rôle, recommandations) et la section **« Migration Ant Design v6 »**.

---

# Audit UI/UX mobile-first et frontend

> Méthode : application réelle (build de production) parcourue en **360×800, tactile, densité de pixels 2**, avec 4 comptes seedés (membre, collecteur, trésorier, développeur) et les pages publiques. Chaque écran a été mesuré automatiquement : débordement horizontal, cibles tactiles < 44 px, éléments interactifs sans nom accessible, champs sans libellé associé, polices de champ < 16 px, textes < 12 px, images sans `alt`. Les captures sont dans `shots/` (vue normale + `-long` = vue entière), `shots/flows/` (parcours) et `shots/v6/` (antd v6).

Planche des preuves principales : `PREUVES_MOBILE_SGM-CEM.png` (8 captures annotées).

## Synthèse chiffrée (56 écrans)

| Mesure | Résultat | Commentaire |
|---|---|---|
| Débordement horizontal de la page | **0 écran** | Bon socle responsive (`100dvh`, safe-area, tableaux transformés en cartes) |
| Débordement local visible | **1** : champ téléphone de la collecte publique | `flex-1` sans `min-w-0` (UX-04) |
| Cibles tactiles < 44×44 px | **688** (jusqu'à 108 sur « Utilisateurs ») | Boutons d'action 28×28, cases à cocher 13×13, icônes « œil » 20×20, fermeture de bannière 14×14 (UX-07) |
| Champs sans libellé programmatique | **156** (8 sur « Mon profil », 71 sur « Fonds collecteurs ») | `<label>` visuel non relié par `htmlFor`/`id` (UX-08) |
| Champs avec police < 16 px | **97** | Zoom automatique d'iOS au focus (UX-08) |
| Nœuds de texte < 12 px | **935** | 78 usages de `text-[9-11px]` dans le code (UX-08) |
| Texte gris clair (`*-gray/slate-300/400`) | **177 usages** | Contraste ≈ 2,6:1 sur blanc, sous le seuil WCAG de 4,5:1 (UX-08) |
| Hauteur de page la plus longue | **17 016 px** (« Fonds collecteurs », trésorier) | Environ 21 écrans de défilement (UX-09) |
| JS au premier chargement de `/dashboard` | **849 kB** (2,1 Mo décodés après connexion) | 0 import dynamique pour 25 vues (UX-12) |
| 3G simulée (1,6 Mbit/s, 300 ms, CPU ralenti 4×) | LCP connexion **4,7 s** ; tableau de bord exploitable **7,2 s** | (UX-12) |
| Erreurs console applicatives | 0 | Hors artefact Google Identity bloqué par le proxy de l'environnement |

**Verdict :** la mise en page tient sur un petit écran, mais **le produit n'est pas conçu mobile-first**. La hiérarchie, la navigation, la densité d'information et les actions principales sont celles d'un back-office de bureau. Les rôles les plus mobiles (membre, collecteur) sont paradoxalement les moins bien servis.

## Constats

### UX-01 — Navigation sans URL : le bouton retour fait quitter l'application
- **Gravité :** Élevé
- **Constat :** toutes les vues vivent sous `/dashboard` et sont choisies par `activeView` (store Zustand **non persisté**, `store/appStore.ts`). Aucun `router.push`.
- **[PREUVE]** Membre : Accueil → onglet Rubriques → `page.goBack()` ⇒ URL `about:blank`. Le geste ou le bouton retour d'Android **ferme l'application ou la page**. Après un rafraîchissement, la vue revient toujours au « Tableau de bord » (`shots/flows/membre-apres-rafraichissement.png`).
- **Conséquences :**
  - pas de lien profond : une notification WhatsApp ou e-mail ne peut pas ouvrir « Validations » ;
  - un clic sur une notification dépend d'un état en mémoire ;
  - impossible de partager un écran ;
  - perte de contexte à chaque rechargement, fréquent sur réseau instable ou lors d'un retour depuis l'application MoMo.
- **Recommandation :** une route App Router par vue (`/app/contributions`, `/app/validations/[id]`…), avec filtres, onglets et page dans `searchParams` (sous `<Suspense>`, règle n°7 de `CLAUDE.md`). Les modales et steppers deviennent des routes interceptées, ou au minimum ajoutent un état à l'historique pour que « retour » ferme la feuille au lieu de quitter l'application.
- **Effort :** moyen.

### UX-02 — Collecteur : deux entrées de menu mènent au mauvais écran
- **Gravité :** Élevé (blocage fonctionnel)
- **Constat :** le menu latéral du collecteur propose « Rubriques » et « Fonds à réceptionner », mais le `switch` du rôle COLLECTEUR (`app/(app)/dashboard/page.tsx:62-72`) n'a pas ces cas : il retombe sur `DashboardCollecteur`.
- **[PREUVE]** Les deux captures `collecteur-03-rubriques` et `collecteur-07-fonds-a-re-ceptionner` affichent « Pierre 👋 ».
- **Conséquence :** un collecteur **destinataire d'un transfert** (rôle éligible dans `/funds/eligible-receivers`) ne peut ni le confirmer ni le refuser. La notification « Transfert à valider » (`targetView: 'transfer-validations'`) ne mène nulle part, et les fonds restent bloqués `EN_TRANSIT`.
- **Recommandation :** ajouter les cas ; plus largement, dériver menu, onglets inférieurs et routes d'**une seule table de permissions**, au lieu de 3 listes divergentes (Sidebar, BottomNav, switch de `page.tsx`).
- **Effort :** faible.

### UX-03 — Espace membre : informations essentielles absentes ou fausses
- **Gravité :** Élevé
- **Constats :**
  - **Pas d'accès aux reçus** : `MesContributions.tsx` n'expose aucun lien de reçu, et la route `GET /contributions/:id/receipt` est réservée au niveau ≥ 2. Un membre qui a perdu le WhatsApp n'a aucun justificatif.
  - **Pas de détail** d'une contribution : mode de paiement, collecteur, date de confirmation, référence, motif de litige. Les lignes ne sont pas cliquables.
  - **Totaux faux** dès 21 contributions : « Montant confirmé » et « En attente » sont calculés sur la page courante de 20 lignes (`MesContributions.tsx:89,137`). La recherche par rubrique filtre aussi la page seule.
  - L'accueil ne montre pas le **reste à payer global** ni l'échéance la plus proche. Cette information n'existe que dans l'onglet Rubriques, sous forme de 11 grandes cartes (`shots/membre-03-rubriques-long.png`).
  - L'avatar de chaque ligne est la lettre « E » (initiale du membre lui-même) : il n'apporte aucune information, une icône de rubrique ou de mode serait utile.
  - Les filtres « Montant min/max » sur l'accueil sont peu utiles sur mobile.
  - Doublons de navigation : « Tableau de Bord » et « Mes Contributions » ouvrent la même vue ; le titre de la barre du haut indique « Tableau de bord » alors que la page s'appelle « Mes contributions ».
- **Recommandation :** accueil membre = carte « Reste à payer » (total + 3 rubriques prioritaires + bouton Payer), puis les 3 derniers paiements avec bouton « Reçu ». Agrégats côté API (`/contributions/me/summary`). Détail en feuille inférieure (bottom sheet). Route de reçu ouverte au propriétaire.
- **Effort :** moyen.

### UX-04 — Page publique de collecte incomplète et champ téléphone qui déborde
- **Gravité :** Moyen
- **Constats [PREUVE]** (`shots/public-collecte-long.png`, `shots/flows/public-etape-2.png`) :
  - le **titre** de la collecte (`titre`) et son caractère **urgent** (`isUrgent`), pourtant renvoyés par l'API, ne sont **jamais affichés**. Seule la description apparaît, sous l'en-tête générique « SGM-CEM · Espace de collecte sécurisé » ;
  - le champ téléphone sort de la carte à droite (`PublicCollecteStepper.tsx:456`, `flex-1` sans `min-w-0`) ;
  - les 4 étapes n'ont **aucun libellé** (pastilles 1-2-3-4) ;
  - l'erreur de validation s'affiche en bas du formulaire, sans mise en évidence ni focus du champ fautif.
- **Recommandation :** en-tête avec titre, badge « Urgent », organisme et contact ; libellés d'étapes ; `min-w-0` ; erreurs sous chaque champ, avec `aria-invalid` et focus sur le premier champ en erreur.
- **Effort :** faible.

### UX-05 — Barre d'onglets inférieure incomplète selon le rôle
- **Gravité :** Moyen
- **Constat :** onglets actuels (`BottomNav.tsx`) :
  - **Membre** : 2 onglets (Mes dons, Rubriques), sans Payer, Profil ni Notifications ;
  - **Collecteur** : Accueil, Paiements, Fonds, **sans « Validations »**, qui est pourtant sa tâche quotidienne (confirmer les espèces déclarées) ;
  - **Staff** : Accueil, Rubriques, Paiements, Membres, sans Validations ni Fonds à réceptionner (les compteurs n'apparaissent que dans le tiroir).

  Le vocabulaire varie pour un même objet : « Paiements », « Contributions », « Mes dons ».
- **Recommandation :** 4 à 5 onglets orientés tâches, avec badges de compteur. Voir « Cible mobile-first par rôle » ci-dessous.
- **Effort :** faible.

### UX-06 — Bannière de notifications envahissante
- **Gravité :** Moyen
- **Constat :** bandeau jaune d'environ 180 px de haut en tête de **chaque écran**, soit près du quart de la hauteur utile.
  - En état « refusé », il donne une consigne de bureau (« cliquez sur le cadenas 🔒 à côté de l'adresse ») sans objet dans une PWA installée.
  - La fermeture ne vaut que pour la session (`sessionStorage`), et la croix mesure 14×14 px.
- **Recommandation :** demander la permission **dans le contexte**, par exemple après un premier paiement (« Être prévenu quand le collecteur confirme ? »). En cas de refus, une simple ligne dans « Mon profil → Notifications ». Mémoriser le refus (`localStorage`).
- **Effort :** faible.

### UX-07 — Cibles tactiles trop petites et actions collées
- **Gravité :** Moyen
- **Constat :** 688 cibles sous 44 px. Exemples :
  - actions de ligne 28×28 (Modifier, Réinitialiser, Désactiver, « Se connecter en tant que ») ;
  - cases à cocher de sélection des fonds 13×13 ;
  - filtres de rubriques 26 px de haut ;
  - icônes « afficher le mot de passe » 20×20.

  Dans « Validations », **« Confirmer » et « Litige » sont côte à côte, sans confirmation** : un pouce imprécis confirme un encaissement. « Archiver » une rubrique se fait aussi en un geste. Le reste de l'application utilise ailleurs `window.confirm` natif, d'où des dialogues incohérents.
- **Recommandation :** taille minimale de 44 px (règle de lint ou classe utilitaire). Menu d'actions « ⋯ » en feuille inférieure. Confirmation (`App.useApp().modal.confirm` d'antd) avec résumé montant / membre pour les actions financières ou irréversibles.
- **Effort :** moyen.

### UX-08 — Accessibilité et lisibilité
- **Gravité :** Moyen
- **Constats :**
  - `viewport.maximumScale: 1` (`app/layout.tsx`) **empêche le zoom**, contraire au critère WCAG 1.4.4 ;
  - 156 champs sans libellé associé, dont tout « Mon profil » et les sélecteurs de « Fonds collecteurs » ;
  - 97 champs en < 16 px, donc zoom forcé sur iOS ;
  - 935 textes < 12 px ;
  - texte gris clair très utilisé (contraste insuffisant) ;
  - 6 zones `aria-live`/`role=alert` seulement pour toute l'application : les toasts et erreurs ne sont pas annoncés aux lecteurs d'écran ;
  - la police est chargée par `@import` Google Fonts dans le CSS, ce qui bloque le rendu et provoque un saut visuel.
- **Recommandation :** retirer `maximumScale` ; champs à 16 px minimum ; `htmlFor`/`id` systématiques (ou `Form.Item` d'antd) ; `text-slate-500` au minimum pour le texte secondaire ; `next/font` pour Montserrat ; région `aria-live="polite"` pour les toasts ; audit axe-core en CI.
- **Effort :** moyen.

### UX-09 — Pages interminables et densité inadaptée
- **Gravité :** Moyen
- **Constats :**
  - « Fonds collecteurs » (trésorier) : **17 016 px** de haut, sans pagination ni regroupement ;
  - « Utilisateurs » : 6 759 px ;
  - « Contributions » : chaque ligne devient une carte de 7 lignes « libellé : valeur » (environ 400 px par contribution) ;
  - tableaux de bord : les indicateurs s'empilent **un par ligne** (4 cartes de 160 px avant le premier graphique), ce qui donne environ 3 700 px pour le trésorier ;
  - « Rubriques » (membre) répète le titre en sous-titre (« Contribution Projet 2025 / Contribution Projet 2025 ») et garde un gros bouton « Contribuer » même sur les rubriques « À jour ».
- **Recommandation :** listes compactes sur 2 lignes (nom et rubrique à gauche, montant et statut à droite), détail en feuille inférieure ; pagination ou défilement infini côté serveur ; regroupement par collecteur repliable ; indicateurs en grille 2×2 ; titre de section collant (sticky).
- **Effort :** moyen.

### UX-10 — Informations tronquées ou anonymes
- **Gravité :** Moyen
- **Constats :**
  - « Activité récente » affiche « Jean-… », « Membr… », « CD-2025 · MTN … » : le nom et le mode sont coupés au profit de « Il y a 1h » ;
  - les contributions sans membre affichent **« Membre inconnu » ou « — »**. C'est le cas des dons publics, dont le donateur est pourtant connu (`contributeurExterne`, jamais inclus par l'API dans `/contributions` ni `/stats`), et des remises groupées déclarées par le staff sans `membreId` ;
  - « Attendu : — » dans le formulaire rapide ;
  - libellés sans accents : « A remettre », « Delai max », « Telephone paiement », « Reference », « Transferer ».
- **Recommandation :** inclure `contributeurExterne` (nom + badge « Don public ») ; libellé « Remise groupée (déclarée par X) » ; date relative sur une seconde ligne ; relecture orthographique (voir `design:ux-copy`).
- **Effort :** faible.

### UX-11 — Parcours de paiement trop complexe pour un membre
- **Gravité :** Moyen
- **Constats** (`shots/flows/membre-stepper-*.png`) :
  - « Faire une contribution » ouvre d'emblée **« Répartir votre paiement »** : budget total vide sans exemple, puis lignes à ajouter une par une avec un `<select>` de 11 rubriques, puis montants. C'est le cas avancé imposé à tout le monde ;
  - le reste à payer n'est ni proposé ni prérempli ;
  - le mode carte s'affiche « Temporairement indisponible » mais reste présenté comme une option ;
  - 4 étapes en tout ;
  - côté collecteur, coexistent **trois** entrées : « Rapide », « Guidé » et « Déclarer », chacune avec son propre formulaire et des différences subtiles.
- **Recommandation :** parcours par défaut en 3 écrans. (1) Choisir une rubrique, avec le montant dû prérempli et des montants rapides. (2) Moyen de paiement et numéro (préremplis depuis le profil). (3) Confirmer, avec le total commission incluse bien visible. La répartition devient un lien « Payer plusieurs rubriques ». Côté collecteur, **un seul** bouton « Encaisser » qui demande d'abord « Espèces reçues en main / Déclaration à confirmer ». Les modes indisponibles sont masqués.
- **Effort :** moyen.

### UX-12 — Performance perçue sur réseau mobile
- **Gravité :** Moyen
- **Constats :**
  - `/dashboard` : 849 kB de First Load JS, car les 25 vues sont importées statiquement dans `dashboard/page.tsx` (aucun `next/dynamic`). Recharts, framer-motion et exceljs sont chargés même pour un membre ;
  - 3G simulée : LCP de la page de connexion 4,7 s ; tableau de bord exploitable 7,2 s ; 2,1 Mo de JS décodé ;
  - deux requêtes Google Fonts bloquent le rendu ;
  - un écran d'accueil animé (SplashScreen) masque le contenu à chaque nouvelle session.
- **Recommandation :** routes par vue (UX-01), d'où un découpage naturel ; `next/dynamic` pour les graphiques et l'export Excel ; `next/font` ; retirer framer-motion là où une transition CSS suffit ; viser < 250 kB de JS pour l'accueil membre ; mesurer avec Lighthouse CI (budget de performance).
- **Effort :** moyen.

### UX-13 — Microcopie et cohérence
- **Gravité :** Faible
- **Constats :**
  - majuscules incohérentes (« Tableau de Bord » / « Tableau de bord ») ;
  - « Paiements », « Contributions » et « Mes dons » désignent la même chose ;
  - messages API sans accents ;
  - « Contribution libre — montant à votre convenance » répété sur chaque carte ;
  - le bouton Google indique « (non configuré) » aux utilisateurs finaux au lieu d'être masqué.
- **Effort :** faible.

### UX-14 — États vides, chargement, hors ligne
- **Gravité :** Faible
- **Constats :**
  - « Notifications » vide : bouton « Tout marquer lu » actif sans objet ;
  - l'infobulle « Notifications » d'antd reste affichée après un toucher (`shots/flows/membre-notifications.png`) ;
  - la file hors ligne n'est visible que par un bandeau de compteur, sans liste ni annulation ;
  - pas d'indicateur de fraîcheur des données (dernière synchronisation) alors que l'application polle.
- **Effort :** faible.

### UX-15 — Dette du système de design
- **Gravité :** Faible
- **Constats :**
  - **870 couleurs hexadécimales codées en dur** (77 distinctes) dans les `.tsx`, alors que des jetons existent (`--cem-*` dans `globals.css`, `lib/antd-theme.ts`) ;
  - trois couches UI concurrentes :
    - antd (11 fichiers seulement) ;
    - composants maison `components/ui/*` (Button, Modal, Input, Toast…) qui doublonnent antd ;
    - **Radix UI : 10 paquets installés, 0 import** ;
  - `darkTheme` défini mais jamais utilisé ;
  - surcharges d'antd par classes internes (`.ant-menu-item-group-title`, `.ant-modal-content`…) et `!important` Tailwind, fragiles à chaque mise à jour (voir la régression v6 ci-dessous).
- **Recommandation :** choisir **antd v6 comme bibliothèque de composants unique** (Form, Select, Drawer, Modal, Segmented, Steps, Empty, Skeleton) et Tailwind pour la mise en page ; supprimer les paquets Radix et les doublons `ui/` ; jetons uniques (thème antd en variables CSS v6, lues par Tailwind) ; API sémantique `classNames`/`styles` au lieu des sélecteurs `.ant-*`.
- **Effort :** moyen.

### UX-16 — Graphiques et tableaux de bord sur petit écran
- **Gravité :** Faible
- **Constats :**
  - le graphique mensuel du trésorier tient sur 330 px avec des étiquettes d'axe tronquées (« ınv. », « sept. ») ;
  - un seul pic visible quand il y a peu de données ;
  - « Répartition des paiements » en anneau pour 2 valeurs ;
  - « Top contributeurs », « Grand contributeur 2026 » et « Taux par rubrique » répètent la même information.
- **Recommandation :** sur mobile, 2 à 3 indicateurs avec tendance comparée au mois précédent, une liste « à traiter » (validations, transferts, litiges), et les graphiques détaillés dans « Statistiques ».
- **Effort :** faible.

### UX-17 — PWA
- **Gravité :** Information
- **Constats :**
  - manifeste sans icône `maskable`, sans `id`, sans captures d'écran : l'invite d'installation est moins riche sur Android ;
  - `orientation: portrait` imposée, ce qui gêne les tablettes en paysage ;
  - le service worker ne met en cache que le statique (correct pour la sécurité). En revanche, il n'y a pas de page hors ligne explicite, ni de **mise à jour signalée** quand une nouvelle version est déployée.
- **Effort :** faible.

## Cible mobile-first par rôle (proposition)

| Rôle | Onglets inférieurs (badges) | Écran d'accueil | Action principale |
|---|---|---|---|
| **Membre** | Accueil · Payer · Historique · Profil | « Reste à payer » total + 3 rubriques prioritaires ; 3 derniers paiements avec bouton **Reçu** ; statut des espèces déclarées (« en attente de Pierre O. ») | Bouton **Payer** pleine largeur, collé en bas au-dessus de la barre d'onglets |
| **Collecteur** | Accueil · Encaisser · **À valider (n)** · Mes fonds | « Fonds en ma possession » (montant, ancienneté, délai max) + « À valider (n) » + « Transferts à recevoir (n) » | **Encaisser** (espèces) et **Remettre** (transfert) |
| **Responsable / Trésorier** | Accueil · Validations (n) · Fonds (n) · Membres · Plus | Liste « À traiter aujourd'hui » (validations, transferts, litiges, paiements bloqués) puis indicateurs en 2×2 | Valider en lot, avec confirmation récapitulative |
| **Admin / Dev** | Accueil · Utilisateurs · Paramètres · Plus | Santé du système (paiements bloqués, erreurs fournisseur) | — |

**Principes transverses :**
- une URL par écran ;
- détails et formulaires dans des **feuilles inférieures** (`Drawer placement="bottom"` d'antd v6) ;
- bouton d'action principal fixé en bas dans la zone du pouce (`env(safe-area-inset-bottom)`) ;
- formulaires avec `inputMode="numeric"`/`"tel"`, `autoComplete`, valeurs préremplies depuis le profil ;
- montants toujours accompagnés de « dont commission » ;
- confirmations pour l'argent ;
- squelettes de chargement par carte ;
- états vides avec une action ;
- textes ≥ 14 px, champs ≥ 16 px, cibles ≥ 44 px.

## Plan de recette UI recommandé
- Playwright mobile en CI : les scripts `run/mobile-audit.js` et `run/mobile-flows.js` sont réutilisables, en échouant au-delà de seuils (0 champ sans libellé, 0 cible < 44 px sur les actions principales, 0 débordement).
- `@axe-core/playwright` sur chaque route ; Lighthouse CI avec budget JS et LCP en 3G.
- Tests sur appareils réels : Android d'entrée de gamme (Chrome, 2 Go de RAM) et iPhone (Safari), en PWA installée ; clavier virtuel ; retour depuis l'application MoMo ; perte de réseau pendant un paiement.
- 5 tests utilisateurs (2 membres, 2 collecteurs, 1 trésorier) sur les tâches « payer », « déclarer des espèces », « confirmer une remise », « transférer des fonds ».

---

# Migration Ant Design v6

## Faisabilité : **oui, effort faible** [PREUVE]
- **Prérequis :** React ≥ 18 (le projet est en 19.2.7), navigateurs modernes avec variables CSS (cohérent avec une PWA mobile). `antd@6.6.6` est la version stable (`latest`, publiée le 12/10/2026 ; branche v6 stable depuis le 21/11/2025). `@ant-design/nextjs-registry@1.3.0` accepte antd ≥ 5 et Next ≥ 14.
- **Empreinte actuelle d'antd : faible.** 11 fichiers l'importent (connexion, collecte publique, layout Sidebar/TopBar, Dashboard, PaymentStepper, ContributionGuideeStepper, ReceiptSuccessModal, providers, thème). Le reste de l'interface est du Tailwind avec les composants maison `components/ui/*`.
- **Essai réel sur une copie jetable du monorepo** (`antd6/`, le dépôt n'est pas touché ; correctif complet dans `antd-v6-migration.patch`) :

| Étape | Résultat |
|---|---|
| `antd ^6.6.6`, `@ant-design/cssinjs ^2.1.2` (était épinglé à 1.24.0 ; doit suivre antd pour garder une seule instance de cache de styles), `@ant-design/nextjs-registry ^1.3.0`, suppression de `@ant-design/v5-patch-for-react-19` et de son import dans `app/layout.tsx` | Installation OK |
| `tsc --noEmit` avant correction | **2 erreurs** : `Modal styles.content` n'existe plus (`ContributionGuideeStepper.tsx:30`, `PaymentStepper.tsx:471`) |
| Corrections : `styles.content` → `styles.container` (Modal, ×2) ; `Drawer width` → `size`, `styles.content` → `styles.section` (Sidebar) ; `Alert message` → `title` (×5 : Dashboard, PaymentStepper ×2, page de connexion, collecte publique) | **7 lignes de code** |
| `tsc --noEmit` | **0 erreur** |
| `next build` | **OK** ; `/dashboard` 848 kB (contre 849 kB : la v6 ne réduit pas la taille à elle seule) |
| `vitest` web | **23/23** |
| Playwright (connexion, tiroir, stepper, tableau de bord, collecte publique) | **0 avertissement de dépréciation** dans la console ; rendu identique, sauf la régression ci-dessous |

## Régression détectée et correctif
- **Feuille de paiement plein écran sur mobile.** `PaymentStepper.tsx` cible `.ant-modal-content` dans son `className`. En v6, ce nœud devient **`.ant-modal-container`**, et le tiroir passe de `.ant-drawer-content` à **`.ant-drawer-section`** (mesuré dans le DOM). Les règles `max-sm:h-[100dvh]`, `rounded-none` et flex-colonne ne s'appliquent donc plus. La modale devient une carte arrondie de 787 px de haut au lieu d'une feuille plein écran (`shots/v6/membre-stepper.png`). Les ombres de `globals.css` sur `.ant-modal-content` et `.ant-drawer-content` deviennent également mortes.
- **Correctif :** utiliser l'**API sémantique** au lieu des classes internes : `classNames={{ container: 'max-sm:h-[100dvh] max-sm:rounded-none flex flex-col …', body: 'min-h-0 flex-1 overflow-y-auto' }}`, et `ConfigProvider` `modal`/`drawer` pour les ombres. Les sélecteurs `.ant-menu-item-group-title` et `.ant-menu-item-selected` de la Sidebar existent encore en v6 (vérifié), mais doivent migrer vers les jetons `Menu` du thème.
- **Autres points de la check-list officielle :**
  - le flou du masque (`mask.blur`) est désactivé par défaut depuis 6.3, et la Sidebar le pose déjà manuellement ;
  - `Tag` perd sa marge de fin par défaut (un `Tag` utilisé dans `Dashboard.tsx`, avec déjà `m-0`) ;
  - `size="default"` devient `"medium"` (non utilisé ici) ;
  - `@ant-design/icons` n'est pas utilisé directement (le projet utilise lucide).

## Procédure recommandée
1. **D'abord la sécurité** : passer Next.js à ≥ 15.5.24 (V-01). Ce chantier est indépendant d'antd, mais il évite de recetter deux fois.
2. Branche dédiée : appliquer `antd-v6-migration.patch` (4 dépendances + 7 lignes), puis `pnpm install`.
3. Corriger la feuille de paiement avec `classNames.container` ; supprimer les sélecteurs `.ant-*` de `globals.css`, `PaymentStepper.tsx` et `Sidebar.tsx`.
4. Recette : `pnpm type-check`, `next build`, `vitest`, scripts Playwright mobiles ; vérifier l'absence d'avertissements `[antd: …]` en console.
5. **Ensuite, tirer parti de la v6 pour le mobile-first** (UX-15) :
   - `Drawer placement="bottom"` comme feuille inférieure ;
   - `Form`/`Form.Item` pour des libellés accessibles ;
   - `App.useApp()` pour `message` et `modal.confirm` (remplace `window.confirm` et les toasts maison) ;
   - `Segmented` et `Steps type="dot"` ;
   - thème en variables CSS partagé avec Tailwind ;
   - suppression progressive des doublons `components/ui/*` et des paquets Radix inutilisés.

**Estimation :** migration technique 0,5 jour ; correction des sélecteurs 0,5 jour ; recette mobile 1 jour. L'unification UI (étape 5) relève du chantier UX, 1 à 2 semaines.

---

# Plan d'action priorisé

| Priorité | Action | Impact | Effort | Risque si non traité | Responsable suggéré |
|---|---|---|---|---|---|
| P0 | Mettre à jour Next.js ≥ 15.5.24 et les dépendances runtime critiques (V-01) | Supprime une RCE non authentifiée | Moyen | Compromission du serveur web | Lead frontend + DevOps |
| P0 | Seed de production sans démo, mots de passe aléatoires, `mustChangePassword` serveur, rotation (V-02) | Ferme un accès trésorier immédiat | Faible | Prise de contrôle financière | Lead backend |
| P0 | Confirmation manuelle limitée aux espèces et virements ; suppression ou restriction de `claim` et `/collecteurs/transfer` (V-03, V-04, V-11) | Intégrité des encaissements | Faible | Reçus sans paiement, détournement | Lead backend |
| P0 | Fermer les ports PostgreSQL et Redis, mots de passe forts, non-root (V-08) | Protège toute la base | Faible | Fuite ou altération totale | DevOps |
| P0 | Faire tourner la clé Yelii exposée dans la doc si elle est réelle ; purger la doc (V-17) | Évite l'usage frauduleux de l'API de paiement | Faible | Opérations sur le wallet | Responsable technique |
| P1 | Corriger la confirmation des lots multi-rubriques et faire le backfill (V-05) | Débloque les paiements réels | Moyen | Membres débités mais « impayés » | Lead backend |
| P1 | Échapper les PDF et isoler Chromium (V-06) | Supprime le vecteur SSRF | Faible | Pivot réseau interne | Lead backend |
| P1 | Révocation des sessions, `isActive` au refresh, rotation (V-07) | Retrait d'accès effectif | Faible | Ex-collecteur actif 7 jours | Lead backend |
| P1 | `trust proxy` et rate-limit par utilisateur (V-09) | Disponibilité | Faible | Application inutilisable en production | Lead backend |
| P1 | Ajouter les vues manquantes du collecteur (Rubriques, Fonds à réceptionner) et une table de permissions unique (UX-02) | Débloque la réception des transferts | Faible | Fonds bloqués « en transit » | Lead frontend |
| P1 | Navigation par URL : bouton retour, liens profonds, rafraîchissement (UX-01) | Usage mobile normal | Moyen | Utilisateurs « éjectés » de l'application | Lead frontend |
| P1 | Espace membre : reçus, détail, totaux côté API, reste à payer en accueil (UX-03) | Confiance des membres, moins de sollicitations des collecteurs | Moyen | Membres sans justificatif, chiffres faux | Lead frontend + backend |
| P1 | Collecte publique : titre, urgence, libellés d'étapes, champ téléphone (UX-04) | Conversion des dons | Faible | Donateurs perdus | Lead frontend |
| P1 | CI réparée (seed, rate-limit en test, couverture, audit, lint web) (V-31) | Filet de sécurité | Faible | Régressions silencieuses | DevOps / QA |
| P2 | Litiges, atomicité des transferts et dépôts, idempotence publique et hors ligne (V-10, V-12, V-13, V-20) | Cohérence comptable | Moyen | Doubles débits, comptes faux | Lead backend + frontend |
| P2 | GED niveau 2, « mot de passe oublié » et OTP renforcés, CSRF secret obligatoire (V-14 à V-16, V-18) | Confidentialité | Faible / Moyen | Fuite de documents, énumération | Lead backend |
| P2 | Migration Ant Design v6 (correctif prêt, 4 dépendances + 7 lignes) + suppression des sélecteurs `.ant-*` | Socle UI à jour, API sémantique | Faible | Dette, blocage des futures mises à jour | Lead frontend |
| P2 | Accessibilité mobile : zoom, cibles 44 px, libellés, polices ≥ 16 px, contrastes, confirmations financières (UX-07, UX-08) | Utilisable par tous, moins d'erreurs de saisie | Moyen | Erreurs de confirmation, exclusion | Lead frontend + designer |
| P2 | Barre d'onglets par rôle, bannière push contextuelle, parcours de paiement simplifié (UX-05, UX-06, UX-11) | Tâches clés en 1–2 touchers | Moyen | Abandon des paiements | Designer + lead frontend |
| P2 | Performance : découpage par route, `next/dynamic`, `next/font`, budget Lighthouse (UX-12) | Accueil < 3 s en 3G | Moyen | Lenteur perçue, abandon | Lead frontend |
| P2 | Singleton Prisma, pool Chromium, pagination, agrégations SQL (V-21) | Stabilité sous charge | Moyen | Saturation de la base, fuites mémoire | Lead backend |
| P2 | Chiffrement des secrets en base (V-17) | Défense en profondeur | Moyen | Vol de toutes les clés si fuite de la base | Lead backend |
| P3 | Listes compactes et feuilles inférieures, informations complètes (dons publics, remises groupées), microcopie, unification du système de design sur antd v6 + Tailwind (UX-09, UX-10, UX-13 à UX-17) | Lisibilité, cohérence, maintenabilité | Moyen | Dette UI croissante | Designer + lead frontend |
| P3 | Machine à états, grand livre, remboursements, migrations Prisma, BullMQ | Pérennité, auditabilité | Élevé | Dette croissante, litiges insolubles | Architecte |
| P3 | Nettoyage du code mort et de la documentation (Yelii hérité, Redis, MTN/Orange, IP figée) (V-22, V-31) | Lisibilité | Faible | Erreurs de configuration | Équipe |
| P3 | Campagne E2E Playwright, accessibilité et sandbox fournisseurs | Assurance qualité | Moyen | Bugs en production non détectés | QA |

---

## Annexe — Trace de l'audit

**Fichiers inspectés intégralement :**
- API, cœur et routes : `apps/api/src/index.ts`, `lib/*`, `middleware/*`, `routes/auth.ts`, `developer.ts`, `users.ts`, `payments.ts`, `public.ts`, `contributions.ts`, `funds.ts`, `notifications.ts`, `settings.ts` ;
- API, webhooks, jobs et services : `webhooks/*`, `jobs/payment-reconciliation.ts`, `services/yelii.service.ts`, `cinetpay.service.ts`, `payment-status.service.ts`, `payment-batch.service.ts`, `payment.ts`, `storage.ts`, `cron.ts` (début) ;
- Prisma et déploiement : `prisma/seed.ts` (début), `schema.prisma` (extraits), `docker-compose.yml`, `apps/*/Dockerfile`, `docker-entrypoint.sh`, `.env.example`, `.github/workflows/ci.yml`, `DEPLOIEMENT_DOCKER.md`, `CLAUDE.md` ;
- Web : `next.config.ts`, `lib/api.ts`, `store/authStore.ts`, `app/(app)/layout.tsx`, `app/(app)/dashboard/page.tsx`, `public/sw.js` (extraits).

**Fichiers inspectés partiellement :** `routes/collecteurs.ts`, `commissions.ts`, `profile.ts`, `membres.ts`, `audit.ts`, `activity.ts`, `services/receipt.ts`, `config.service.ts`, `notification.ts`, `pdf-branding.ts`, `borderau.ts`, `financial-report.ts`, `apps/web/src/components/views/Validations.tsx`, `Contributions.tsx`, `hooks/useOfflineSync.ts`, `store/appStore.ts`.

**Non lus en détail (survol par recherche) :** `routes/stats.ts`, `collectes.ts`, `rubriques.ts`, `prestations.ts`, `services/activity-write.service.ts`, `email.ts`, `push.service.ts`, la majorité des vues frontend et `docs/`.

**Commandes principales :** `git log` / `show` / `grep` (historique, recherche de secrets sans affichage des valeurs), `pnpm install --frozen-lockfile`, `prisma generate`, `pnpm type-check` (api, web), `pnpm lint` (web), `next build`, `pnpm test` (api, web), `vitest --coverage` (échec : outil absent), `pnpm audit --json`. PostgreSQL 16 local démarré pour une base jetable `sgm_cem_audit`, avec `prisma db push`, seed et seed-config, puis arrêté.

**Scripts de preuve** (hors dépôt, dans le scratchpad) : `poc/proof.ts` (P1 lot, P2 injection HTML) et `poc/proof2.ts` (P3 claim, P4 confirmation MoMo, P5 refresh d'un compte désactivé). `fetch` y est remplacé par un bouchon qui bloque tout appel externe.

**Complément v2 (UI/UX et antd v6)** — tout se trouve dans le scratchpad, hors dépôt :
- `run/api-launcher.js` : démarre l'API inchangée en neutralisant uniquement `express-rate-limit` pour l'audit ;
- `run/mobile-audit.js` : 56 écrans, mesures dans `shots/report.json` ;
- `run/mobile-flows.js` : parcours et 3G, mesures dans `shots/flows/log.json` ;
- `run/v6-check.js` : vérification de la copie migrée, résultats dans `shots/v6/result.json` ;
- `antd6/` : copie migrée ; `antd-v6-migration.patch` : correctif applicable ;
- guide officiel `antd/migration-v6.en-US.md` (dépôt GitHub d'Ant Design) ; métadonnées npm d'`antd` et `@ant-design/nextjs-registry`.

Fichiers frontend lus pour ce complément :
- `app/layout.tsx`, `app/providers.tsx`, `app/globals.css`, `app/(app)/layout.tsx`, `app/(app)/dashboard/page.tsx`, `app/page.tsx` (extraits) ;
- `components/layout/{Sidebar,BottomNav,TopBar}.tsx` ;
- `components/views/{MesContributions,Validations,Contributions,Dashboard}.tsx` (extraits) ;
- `components/payments/{AllocationEditor,PaymentStepper,ContributionGuideeStepper}.tsx` (extraits) ;
- `components/public/PublicCollecteStepper.tsx` (extraits) ;
- `lib/antd-theme.ts`, `public/manifest.json`, `public/sw.js`.

Une ligne de base de démonstration a été ajoutée **dans la base jetable uniquement** (collecte publique `audit-collecte-mobile`). PostgreSQL, l'API et le web ont été arrêtés en fin d'audit.
