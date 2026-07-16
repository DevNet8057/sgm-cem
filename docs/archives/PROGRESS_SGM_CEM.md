# SUIVI D'AVANCEMENT — SGM-CEM v6.0

Dernière mise à jour : 2026-07-02
Avancement global : **100%** (47/47 tâches)

## Légende

✅ Terminé et vérifié · 🔄 En cours · ⬜ Non commencé · ⚠️ RÉGRESSION · 🔶 Bloqué / FUTURE

---

## J. PANNEAU DÉVELOPPEUR + CONFIGURATION DYNAMIQUE (DEVELOPER_PANEL_SGM_CEM.md — 2026-07-04)

Règle : une case n'est cochée qu'après vérification par un vrai test (exécution, type-check + test unitaire ou requête réelle), pas juste écrite.

- [x] J1. Nouveau rôle DEVELOPER dans l'enum Role + RBAC — ✅ vérifié : enum `UserRole` en base contient DEVELOPER (requête `enum_range`), `requireDeveloper` exporté, niveaux 6 ajoutés (API rbac.ts + web utils.ts), accès ADMIN étendus à DEVELOPER (users/funds/collecteurs/profile/auth/notification), garde-fou `assertCanManageTarget` (un ADMIN ne peut pas gérer un compte DEVELOPER), type-check API+web ✔
- [x] J2. Modèle Prisma SystemConfig (clé-valeur en base) + historique des changements — ✅ vérifié : tables `system_configs` + `system_config_history` créées (`db push` + count via client), enum `ConfigCategory` (7 valeurs) + `AuditAction.DEVELOPER_PANEL_CONFIG_CHANGED` présents en base
- [x] J3. Service de configuration centralisé (lecture DB avec fallback .env) — ✅ vérifié : `services/config.service.ts` (cache mémoire, getConfig/getConfigBool/getConfigNumber, updateConfig transactionnel = base + historique + AuditLog, invalidation immédiate du cache) + `loadConfigCache()` au démarrage dans index.ts. **Test réel : 9/9 vitest passent** (`tests/config-service.test.ts` — DB prime sur .env, changement visible sans redémarrage, secrets JWT/REFRESH/CSRF/DATABASE_URL rejetés)
- [x] J4. Migration : toutes les lectures process.env critiques → service de config — ✅ vérifié : seed `prisma/seed-config.ts` exécuté (32 clés, 7 catégories, idempotent — 2e run 0 création) + élévation devnet8057@gmail.com → DEVELOPER. Migrés vers getConfig() **au moment de l'appel** : yelii.service (base/clé/webhook), cinetpay.service, email (SMTP + transporter reconstruit sur changement), notification (Twilio/360dialog + interrupteurs), storage (S3 client reconstruit), webhooks (MTN secret, redirects), contributions/funds/profile (API_URL), auth (Google client), index.ts (CORS dynamique + middleware MAINTENANCE_MODE), payment-reconciliation (fréquence dynamique), payments+contributions (taux commission dynamique via param `rate` de la fonction partagée — formule unique conservée). GET /api/payments/config expose le taux au frontend. Restent en .env (voulu) : JWT/REFRESH/CSRF secrets, DATABASE_URL, NODE_ENV, PORT. **Tests réels : 52/52 vitest ✔ + type-check API ✔**
- [x] J5. Interface panneau développeur — section Webhooks & Callbacks — ✅ vue `Developer.tsx` (menu latéral interne 7 sections) + carte §4 en tête + item sidebar `roles:['DEVELOPER']` + case page dashboard (`role === 'DEVELOPER'` exact). Routes API `routes/developer.ts` **toutes sous requireDeveloper** — test réel : ADMIN → 403, TRESORIER → 403, sans auth → 401, DEVELOPER → 200
- [x] J6. Interface panneau développeur — section Clés d'intégration — ✅ secrets masqués (••••) côté API (jamais en clair dans GET /config — testé), bouton Afficher avec confirmation + audit (`POST /:key/reveal` testé), bouton « Tester la connexion » Yelii (`POST /config/test/yelii` → wallet/balance)
- [x] J7. Interface panneau développeur — section Paramètres financiers dynamiques — ✅ `YELII_COMMISSION_RATE` en base, passé en paramètre à la fonction partagée (formule unique intacte, 4 tests commission ✔), servi au frontend via `GET /api/payments/config` (PaymentStepper n'affiche plus le taux compilé). Ratios étudiant/couple : note d'harmonisation → page Paramètres ADMIN (pas de doublon, conformément au §5C)
- [x] J8. Interface panneau développeur — section Infrastructure & réseau — ✅ APP_URL/API_URL éditables, CORS relu à chaque requête, MAINTENANCE_MODE (middleware 503 laissant passer auth/developer/csrf/health) + message personnalisé
- [x] J9. Interface panneau développeur — section Comportement système — ✅ RECONCILIATION_INTERVAL_MINUTES (job re-planifié dynamiquement, tick 1 min), MOBILE_MONEY_ENABLED / CASH_ENABLED (403 sur initiate si off), LOG_LEVEL
- [x] J10. Interface panneau développeur — section Notifications — ✅ WHATSAPP_ENABLED / SMS_ENABLED / EMAIL_ENABLED court-circuitent l'envoi dans notification.ts/email.ts (lecture au moment de l'envoi)
- [x] J11. Interface panneau développeur — section Feature flags — ✅ FEATURE_OFFLINE_PWA / FEATURE_QUERY_BUILDER / FEATURE_PERCENT_DISTRIBUTION en base, interrupteurs UI (toggle direct pour les booléens)
- [x] J12. Bouton "Recalculer l'URL de webhook" avec historique — ✅ carte §4 (URL actuelle + nouvelle base + note + Recalculer & Enregistrer + Voir l'historique). Testé : slash final retiré, `/webhooks/yelii` ajouté, effet immédiat dans le cache, rappel d'action manuelle dashboard Yelii, URL invalide → 400
- [x] J13. Audit log spécifique aux changements de configuration technique — ✅ chaque updateConfig écrit `SystemConfigHistory` + `AuditLog(action: DEVELOPER_PANEL_CONFIG_CHANGED)` en transaction ; révélation d'un secret également auditée ; secrets jamais en clair dans l'audit ni l'historique (testé)

- [x] J14 (extension utilisateur, 2026-07-05). **Impersonation développeur** — bouton « Connecter » dans Gestion des utilisateurs (visible DEVELOPER uniquement) : `POST /api/developer/impersonate/:userId` (requireDeveloper, cible active non-DEVELOPER, jeton 1 h marqué `impersonatedBy`, audité `AuditAction.IMPERSONATE` start/stop) + `POST /api/auth/stop-impersonation` (retour un clic, vérifie que l'initiateur est toujours DEVELOPER actif) + bandeau layout « Mode développeur — connecté en tant que X / Revenir à mon compte » + `/me` neutralise `mustChangePassword` en impersonation. La session impersonée n'accède PAS au panneau développeur (403 testé). **Tests réels : 10/10 (`tests/impersonation.test.ts`) · suite 76/76 ✔ · type-check API+web ✔**

**Bugs préexistants corrigés au passage (2026-07-05)** : (1) `usersRouter` était exporté mais **jamais monté** dans index.ts → `GET /api/users` répondait 404 depuis toujours et la vue Gestion des utilisateurs restait vide — monté sur `/api/users`, vérifié live (200, 30 comptes) ; (2) l'animation `page-enter` (fill-mode `both`) laissait `transform: translateY(0)` appliqué en permanence sur `<main>`/les vues → le `position: fixed` des modals devenait relatif au conteneur défilant (popup mal positionné) — keyframe terminé sur `transform: none` (globals.css + tailwind.config.ts), comportement visuel identique.

**Traçabilité des fonds (2026-07-05) — 3 exigences utilisateur** : (1) ADMIN voit qui → qui par quel canal : déjà couvert par `GET /funds/transfers` (senderName/receiverName/transferType, vue globale sauf COLLECTEUR limité aux siens) — testé ; (2) preuve de dépôt banque : **nouveau modèle `BankDeposit`** (référence bordereau/relevé, date, montant, déposant, contributions liées via `Contribution.bankDepositId`) + `GET /funds/bank-deposits` (niveau 4+) + section « Historique des dépôts bancaires » dans Collecteurs.tsx (TRESORIER/ADMIN/DEVELOPER, modal détail) + reprise du dépôt historique depuis l'audit log (1 migré) ; (3) remise collecteur → trésorier PENDING jusqu'à validation : déjà couvert (`PENDING_APPROVAL` par défaut + RB-23 seul le récepteur confirme) — testé structurellement + 403 pour un tiers. **Tests : `tests/funds-traceability.test.ts` 7/7 · suite 83/83 ✔ · type-check API+web ✔ · endpoint vérifié live**

**Notifications push navigateur (2026-07-05)** : Web Push VAPID complet — modèle `PushSubscription` (endpoint unique, upsert multi-appareils), `services/push.service.ts` (clés VAPID lues via getConfig à l'envoi, purge auto des abonnements expirés 404/410), branché sur `notifyInApp` + `broadcast` (chaque notification in-app part aussi dans la barre système), routes `/api/notifications/push/{public-key,subscribe,test}` + DELETE, handlers `push`/`notificationclick` dans sw.js (cache v3), hook `usePushNotifications` + **bannière d'invite reproposée À CHAQUE CONNEXION tant que l'utilisateur n'a pas cliqué Activer** (« Plus tard » = sessionStorage, réapparaît à la session suivante ; permission refusée → instructions cadenas). Clés VAPID générées, dans .env + SystemConfig (VAPID_PRIVATE_KEY secret, section Notifications du panneau dev) + interrupteur `PUSH_ENABLED`. **Tests : `tests/push.test.ts` 7/7 · suite 90/90 ✔ · type-check API+web ✔ · endpoint public-key vérifié live**

**Fix CSRF après refresh silencieux (2026-07-05)** : le jeton CSRF (double-submit) est lié au cookie `access_token` ; après le refresh silencieux (expiration 15 min), `api.ts` gardait l'ancien jeton → **toutes les mutations échouaient en 403 « Jeton CSRF invalide » jusqu'au rechargement** (symptôme : blocage à l'étape Récapitulatif du paiement). Corrigé dans `lib/api.ts` : (1) `initCsrf()` re-exécuté APRÈS `POST /auth/refresh` (rebind au nouveau cookie) ; (2) auto-guérison : toute réponse 403 `CSRF_INVALID` → resynchronisation + un seul rejeu (couvre refresh dans un autre onglet, impersonation, etc.). Reproduit et vérifié live : CSRF(A)+cookie(B) → 403, CSRF(A)+cookie(A) → 200. Type-check web ✔

**Reçu présenté au lieu d'envoyé (2026-07-05, décision utilisateur)** : le reçu PDF n'est PLUS envoyé automatiquement en document WhatsApp — l'étape Résultat du PaymentStepper le présente avec **Voir / Imprimer / Partager** (navigator.share, fallback lien wa.me choisi par l'utilisateur) et ne se ferme plus automatiquement. Le message texte de confirmation WhatsApp reste envoyé. Gate unique dans `sendWhatsAppDocument` : flag `AUTO_SEND_RECEIPT_WHATSAPP` (défaut false, réactivable depuis le panneau développeur, section Notifications — seedé). Espèces : l'URL du reçu est récupérée via `/payments/status/:id` juste après confirmation. Textes du stepper mis à jour (plus de promesse d'envoi WhatsApp). **Type-check API+web ✔ · suite 90/90 ✔**

**🏁 TEST FINAL (étape 10 §8) — serveur RÉEL jamais redémarré** : `scripts/proof-no-restart.cjs` → (1) `YELII_BASE_URL` pointé vers un mock local via PUT panneau, (2) `YELII_WEBHOOK_URL` recalculé via le bouton §4, (3) `POST /api/payments/initiate` réel → le mock « Yelii » a reçu `callbackUrl = https://preuve-sans-redemarrage.example.com/webhooks/yelii` et `amount = 1026` (majoration §1bis intacte : ceil(1000/0.975)). Config restaurée, contribution de test supprimée. **Suite complète : 66/66 tests ✔ · type-check API ✔ · type-check web ✔**

**Adaptations au code réel (signalées avant implémentation)** : (a) `enum Role` du doc → `UserRole` dans le schéma ; (b) « migration Prisma » → `prisma db push` (convention repo) ; (c) `AuditLog{entity,before,after}` du doc → modèle réel `entityType`/`details Json` + nouvelle valeur d'enum `AuditAction.DEVELOPER_PANEL_CONFIG_CHANGED` ; (d) `req.user.fullName` du doc → JWT réel = `{userId, role, email}`, nom récupéré en base ; (e) `YELII_API_KEY` du doc → `YELII_COLLECT_API_KEY` conservé (décision antérieure, cf. journal 2026-07-03 v3) ; (f) `CLAUDE.md` inexistant → `CLAUDE_SGM_CEM.md` mis à jour à l'étape 11 ; (g) compte DEVELOPER = élévation de ADMIN_EMAIL (option « élever ton compte personnel » du doc), DEVELOPER conserve tous les accès ADMIN ; (h) sécurité : le `z.enum` de création/édition d'utilisateurs n'inclut PAS DEVELOPER — un ADMIN ne peut pas attribuer ce rôle.

---

## JOURNAL (2026-07-03 v3) — COMMISSION YELII 2,5% À LA CHARGE DU CONTRIBUTEUR (PAYMENT_FLOWS §1bis)

Suivi des 13 étapes de la section 14 de `PAYMENT_FLOWS_SGM_CEM_2.md`. Chaque étape cochée a été vérifiée par un test réel (type-check, tests unitaires, ou exécution).

| Étape | Description | Fichiers | Statut vérifié |
|---|---|---|---|
| 1 | Supprimer l'ancien code MTN/Orange non-Yelii | `services/payment.ts` | ✅ `requestMtnMoMo`, `requestOrangeMoney`, `getOrangeAccessToken`, `getMtnMoMoStatus` supprimés (0 appelant). Yelii conservé. Type-check API OK |
| 2 | Schéma Prisma : `amountChargedToPayer`, `commissionPaidByPayer` | `schema.prisma` | ✅ Champs ajoutés + `prisma db push` (DB synchronisée) + types client régénérés |
| 3 | Fonction partagée `calculateAmountWithCommission` | `packages/shared/src/payment-calculations.ts` | ✅ Source UNIQUE (`@sgm-cem/shared`), formule `Math.ceil(due/(1-0.025))`. **Test : 5000 → 5129 (commission 129)** ✔ |
| 4 | `yelii.service.ts` | `services/yelii.service.ts` | ✅ Déjà conforme (en-tête `X-Collect-Api-Key`, HMAC-SHA512). Reçoit le montant majoré. Test live curl : ⏳ manuel (clé réelle) |
| 5 | Webhook + signature 401 | `webhooks/yelii.webhook.ts` | ✅ **Fix critique** : contrôle de cohérence compare désormais Yelii `amount` à `amountChargedToPayer` (le majoré), sinon tout paiement bloqué. Signature 401 déjà en place |
| 6 | Route initiation envoie le montant MAJORÉ | `routes/payments.ts` + `routes/contributions.ts` | ✅ Les 2 chemins Yelii envoient `totalToPay` et stockent `amountChargedToPayer`/`commissionPaidByPayer`. Type-check OK |
| 7 | Route status (polling) | `routes/payments.ts` | ✅ Existante, inchangée |
| 8 | Écran d'attente + détail montant/frais/total | `PaymentStepper.tsx`, `PendingScreen.tsx` | ✅ Détail transparent dans le récap (même fonction partagée) + total affiché sur l'écran USSD. Type-check web OK |
| 9 | Reçu PDF affiche le montant DÛ | `services/receipt.ts` | ✅ Montant principal = `contribution.montant` (déjà conforme) + mention secondaire des frais |
| 10 | Notification WhatsApp sur confirmation | `webhooks/yelii.webhook.ts` | ✅ Branchée, affiche le montant dû (cohérent reçu/stats) |
| 11 | Job de réconciliation | `jobs/payment-reconciliation.ts` | ✅ Existant, messages sur montant dû |
| 12 | E2E complet ngrok | — | 🔶 Manuel — nécessite tunnel public + transaction Yelii réelle (hors environnement). Logique couverte par tests |
| 13 | Mettre à jour la doc | `PROGRESS_SGM_CEM.md` | ✅ Ce journal. ⚠️ `CLAUDE.md` référencé par le doc mais **absent du repo** (voir note) |

**Vérifications automatiques :** API `tsc --noEmit` ✔ · Web `tsc --noEmit` ✔ · 39 tests API existants ✔ · 4 nouveaux tests commission ✔ (`tests/payment-calculations.test.ts`)

**Conflits signalés et résolus :** (a) route `/mobile/initiate` du doc → adaptée à la route réelle `/payments/initiate` (décision utilisateur) ; (b) `YELII_API_KEY` du doc → `YELII_COLLECT_API_KEY` conservé (décision utilisateur) ; (c) contrôle de montant du webhook qui aurait bloqué 100% des paiements majorés → corrigé ; (d) `db push` au lieu de `migrate` (convention repo) ; (e) `CLAUDE.md` inexistant.

**Bug préexistant corrigé au passage :** `lib/antd-theme.ts` avait `colorWarning` en double (erreur TS1117 bloquant le build web) — doublon retiré, comportement runtime inchangé (jaune CEM).

---

## JOURNAL DES CORRECTIONS (2026-07-03 v2) — REFONTE COMPLÈTE FLOW PAIEMENT (Yelii API officielle)

| # | Tâche | Fichiers | Statut |
|---|-------|----------|--------|
| W1 | Correction signature Yelii | `webhooks/yelii.webhook.ts` | ✅ Corrigé — passe de `express.raw()` + bytes bruts à `express.json()` + `JSON.stringify(req.body)` conformément à la doc officielle Yelii (`HMAC_SHA512(key, timestamp + JSON.stringify(body))`) |
| W2 | Sélecteur de mode paiement | `components/payments/PaymentMethodSelector.tsx` | ✅ Créé — 4 boutons (MTN/Orange/Carte/Espèces) avec style propre |
| W3 | Écran d'attente USSD | `components/payments/PendingScreen.tsx` | ✅ Créé — countdown 5min, instructions étape par étape, état expiré |
| W4 | Stepper 4 étapes | `components/payments/PaymentStepper.tsx` | ✅ Créé — Sélection → Mode → Récapitulatif → **Résultat** (4ème étape explicite). Polling, redirect CinetPay, retry |
| W5 | Page retour CinetPay | `app/payment/return/page.tsx` | ✅ Créée — polling 60s, états confirmed/pending/failed, bouton reçu PDF |
| W6 | ContributionStepper | `views/ContributionStepper.tsx` | ✅ Redirige vers PaymentStepper (backward compat avec Contributions.tsx) |

**Changements de step :** 3 → 4 étapes. "Résultat" est maintenant une étape stepper propre (pas un overlay).

---

## JOURNAL DES CORRECTIONS (2026-07-03) — FLOWS DE PAIEMENT

| # | Tâche | Fichiers modifiés | Statut |
|---|-------|------------------|--------|
| P1 | Schéma Prisma | `schema.prisma` | ✅ Déjà complet (externalTransactionId, paymentStatus, netAmount, confirmedAt, enum PaymentStatus) |
| P2 | Service Yelii | `services/yelii.service.ts` | ✅ Correct — verifyYeliiSignature HMAC-SHA512, initiateYeliiPayment, getYeliiStatus |
| P3 | Webhook Yelii | `webhooks/yelii.webhook.ts` | ✅ Corrigé — bug critique : processYeliiWebhook lisait `payload.transactionId` au lieu de `payload.data.transactionId` (enveloppe `{ event, data }` non dépliée) + statut ANNULE manquant en cas d'échec |
| P4 | Service CinetPay | `services/cinetpay.service.ts` | ✅ Créé — initiateCinetpayPayment, verifyCinetpaySignature (MD5) |
| P5 | Webhook CinetPay | `webhooks/cinetpay.webhook.ts` | ✅ Créé — idempotence, statut CONFIRME/ANNULE, WhatsApp + reçu PDF |
| P6 | Route paiements | `routes/payments.ts` | ✅ Corrigé — 3 bugs : (1) status endpoint cherchait par externalTransactionId au lieu de id, (2) espèces ne mettait pas statut CONFIRME ni confirmedAt, (3) modePaiement YELII non résolu en MTN_MOMO/ORANGE_MONEY. Ajout CinetPay. |
| P7 | index.ts | `index.ts` | ✅ Webhook CinetPay enregistré avant express.json() |
| P8 | Variables env | `apps/api/.env` | ✅ YELII_COLLECT_API_KEY, YELII_BASE_URL, CINETPAY_API_KEY/SITE_ID ajoutés |
| P9 | Frontend stepper | `ContributionStepper.tsx` | ✅ Countdown USSD 5min, écran redirect CinetPay, window.open CinetPay, state 'timeout', polling unifié par contrib.id |

**Règles respectées :** RB-01 (confirmedAt côté serveur), RB-02 (jamais confirmé sans webhook sauf espèces), RB-12 (idempotence)

---

## JOURNAL DES CORRECTIONS (2026-07-02)

| # | Erreur | Cause réelle | Fichier modifié | Correction |
|---|--------|-------------|-----------------|------------|
| 1 | Google OAuth bloqué par CORS | `crossOrigin="anonymous"` sur `<Script>` Google GSI forçait une requête CORS que Google ne supporte pas pour ce fichier | `apps/web/src/app/layout.tsx` | Suppression de `crossOrigin="anonymous"` |
| 2 | Helmet CSP non configuré | `helmet()` sans options bloquait implicitement les ressources Google via les headers CSP renvoyés par l'API | `apps/api/src/index.ts` | CSP explicite : `accounts.google.com` autorisé dans `scriptSrc`, `connectSrc`, `frameSrc` |
| 3 | `manifest.json` introuvable | Fichier déjà présent et correct — `ERR_CONNECTION_REFUSED` était un symptôme du serveur non démarré | Aucun | Aucune modification nécessaire |
| 4 | WebSocket HMR cassé | Conséquence des erreurs 1+2 | Aucun | Résolu par la correction des erreurs ci-dessus |

---

## AUDIT DE CONFORMITÉ — ÉTAT RÉEL VS DOCUMENTÉ

| Source | Affirmation documentée | État réel constaté | Action requise |
| --- | --- | --- | --- |
| FIX_SUMMARY.md | PasswordInput utilisé à 4 emplacements | ✅ Confirmé | Aucune |
| FIX_SUMMARY.md | Validation Zod frontend et backend | ✅ Confirmé | Aucune |
| FIX_SUMMARY.md | Helmet renforcé (CSP, HSTS, X-Frame-Options) | ✅ Confirmé | Aucune |
| FIX_SUMMARY.md | Rate limiting par endpoint | ✅ Confirmé | Aucune |
| FIX_SUMMARY.md | TypeScript compile sans erreur | ✅ Confirmé | Aucune |
| SECURITY_HARDENING_REPORT.md | JWT stocké en localStorage | ⚠️ Corrigé → HttpOnly cookies | Fait |
| SECURITY_HARDENING_REPORT.md | CSRF absent | ⚠️ Corrigé → double-submit cookie | Fait |
| SECURITY_HARDENING_REPORT.md | RBAC avec niveaux de permission | ✅ Confirmé | Aucune |
| GUIDE_SGM_CEM.md §4.2 | Webhook MTN MoMo | ✅ Confirmé dans webhooks.ts | Aucune |
| GUIDE_SGM_CEM.md §7 | WhatsApp (360Dialog) + SMS Twilio | ✅ Confirmé dans notification.ts | Variables env requises |

---

## 0. SÉCURITÉ CRITIQUE

- ✅ 0.1 Migration tokens JWT → cookies HttpOnly/Secure/SameSite
- ✅ 0.2 Protection CSRF (double-submit cookie, csrf-csrf)
- ✅ 0.3 Build TypeScript propre vérifié (API + Web)
- ✅ 0.4 Champs password via PasswordInput
- ✅ 0.5 Rate limiting login (5/15min), password (3/1h), API (100/15min)
- ✅ 0.6 Vérification de démarrage frontend/backend après libération des ports 3000/3001
- ✅ 0.7 Vérification des identifiants admin et seed de la base

## A. REFONTE DESIGN SYSTEM

- ✅ A1. Palette étendue — sémantique par domaine (Finances vert, Membres bleu, Gestion violet…)
- ✅ A2. Typographie — Cormorant Garamond H1/montants, Plus Jakarta Sans tout le reste
- ✅ A3. Icônes Lucide React cohérentes par domaine
- ✅ A4. Animations — page-enter, skeleton loaders, hover, spinner inline, toasts
- ✅ A5. Responsive — sidebar hamburger <768px, tableaux → cards mobile, KPI 4→2→1 col
- ✅ A6. Logo/favicon — emplacements documentés, fallback initiales conservé
- ✅ A7. Nettoyage états vides, pas d'artefacts dev

## B. FLOW FINANCIER COMPLET

- ✅ B1. Collecteur encaisse directement (directCollection → CONFIRME immédiat + notif membre)
- ✅ B2. Contributeur déclare une remise (POST /contributions/declare + notif collecteur)
- ✅ B3. Collecteur valide la réception (PATCH /:id/confirm → CONFIRME)
- ✅ B4. Transfert fonds (FundsTransfer, PATCH /confirm, /refuse, /cancel)
- ✅ B5. Timeline de traçabilité (GET /:id/timeline + modal dans Contributions.tsx)
- ✅ B6. Trésorier dépose en banque (PATCH /funds/bank-deposit + section dans Collecteurs.tsx)
- ✅ B7. Reçu PDF à chaque transaction (services/receipt.ts + GET /:id/receipt)

## C. PROFILS ET NOTIFICATIONS

- ✅ C1. Upload photo de profil (POST /api/profile/photo — via service stockage S3/local)
- ✅ C2. Photo affichée dans TopBar (avatar avec fallback initiales)
- ✅ C3. Notifications in-app style Telegram (polling 30s, toasts, TopBar)
- ✅ C4. Son configurable — sélecteur 5 sons Web Audio dans Paramètres, préférence localStorage

## D. FILTRES AVANCÉS — QUERY BUILDER

- ✅ D1. Query builder Contributions (statut, mode paiement, montant min/max, rubrique)
- ✅ D2. Filtres chips Membres (groupe × 6, profil × 3, statut × 3 — API-side) + Filtres chips Rubriques (type × 3, statut × 3 — client-side)

## E. RÈGLES FINANCIÈRES PARAMÉTRABLES

- ✅ E1. Simulateur de ratios en temps réel dans Paramètres (Travailleur / Étudiant / Couple / N+1)
- ✅ E2. Auto-calcul amountEtudiant/amountCouple à la saisie du montant travailleur dans RubriqueEditor

## F. MODE HORS LIGNE (PWA)

- ✅ F1. Service Worker (public/sw.js) + manifest — network-first navigation, cache-first assets
- ✅ F2. IndexedDB offline queue (lib/offlineQueue.ts) + banner hors-ligne (layout.tsx)
- ✅ F3. Synchronisation auto au retour réseau (hooks/useOfflineSync.ts)

## G. INTÉGRATIONS API EXTERNES

- ✅ G1. MTN Mobile Money — services/payment.ts + webhook + .env.example documenté
- ✅ G2. Orange Money — services/payment.ts + webhook + .env.example documenté
- 🔴 G3. WhatsApp Business (360dialog) — services/notification.ts + .env.example
- 🔴 G4. SMS Twilio fallback — services/notification.ts + .env.example
- ✅ G5. Stockage S3-compatible — services/storage.ts (S3 ou fallback local transparent)

## I. FLOWS DE PAIEMENT (Section 9-14 de PAYMENT_FLOWS_SGM_CEM.md)

- ✅ I1. Schéma Prisma mis à jour (externalTransactionId, paymentStatus, netAmount, paymentUrl + enum PaymentStatus)
- ✅ I2. Service Yelii créé (yelii.service.ts — vérification signature HMAC-SHA512)
- ✅ I3. Webhook Yelii séparé (yelii.webhook.ts — enregistré AVANT express.json dans index.ts)
- ✅ I4. Route POST /api/payments/initiate créée (stepper 3 étapes)
- ✅ I5. Receipt PDF intégré (generateReceiptPDF retourne URL + notif WhatsApp)
- ✅ I6. Écran d'attente frontend + polling (ContributionStepper.tsx mis à jour)
- 🔴 I7. CinetPay service + webhook + route (à implémenter)
- 🔴 I8. Job de réconciliation failsafe (à implémenter)

**Notes:** Le flow Mobile Money (Yelii) est maintenant fonctionnel. Le webhook utilise la signature HMAC-SHA512, le statut est stocké dans `paymentStatus`, et le reçu PDF est généré automatiquement. Le flow Carte Bancaire (CinetPay) et le job de réconciliation restent à implémenter.

## H. DETTE TECHNIQUE

- ✅ H1. Mode offline collecteur (IndexedDB) — fusionné avec F
- ✅ H2. Upload réel GED (commissions.ts multipart + storage service + bouton download)
- ✅ H3. Reçu PDF (services/receipt.ts branché sur GET /:id/receipt)
- ✅ H4. Relevé mensuel automatique (services/cron.ts — 1er du mois 08h00 WAT + endpoint manuel)
- ✅ H5. Tests automatisés API (vitest — tests/auth, contributions, security, routes) — 38/38 passent
- ✅ H6. CI/CD GitHub Actions (.github/workflows/ci.yml — typecheck + test + build)
- ✅ H7. Preuve de paiement (POST /:id/proof + upload Contributions.tsx + lien "Voir preuve" dans Validations.tsx et Litiges.tsx)
- ✅ H8. WebSocket temps réel (Socket.IO — confirm/litige/resolved broadcastés aux membres + rôles + invalidation React Query)

---

## ACTIONS AVANT MISE EN PRODUCTION

| Action | Priorité | Commande / Note |
| --- | --- | --- |
| DB migration proofUrl | ✅ Fait | `prisma db push` exécuté — schéma synchronisé (proofUrl + proofUploadedAt en base) |
| Seed contributions | ✅ Fait | 50+ contributions de démo (3 mois) — seed idempotent corrigé |
| CI prisma migrate | ✅ Corrigé | `prisma db push` dans CI (pas de migrations) |
| CI Puppeteer | ✅ Corrigé | `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` dans CI |
| Variables env prod | 🔴 Critique | Renseigner `.env` depuis `.env.example` (toutes sections G1-G5) |
| Bucket S3 ou R2 | 🟠 Important | Cloudflare R2 recommandé (gratuit 10 Go, compatible S3) |
| Clés MTN/Orange | 🟡 Optionnel | Mode sandbox disponible sans clés prod |
| Clés 360Dialog | 🟡 Optionnel | Fallback SMS Twilio disponible |
| CRON_SECRET | 🟠 Important | Générer un secret fort pour l'endpoint cron manuel |

---

## JOURNAL DE BORD

| Date | Tâche | Statut |
| --- | --- | --- |
| 2026-06-18 | Audit conformité + sécurité (HttpOnly JWT, CSRF) | ✅ |
| 2026-06-18 | Refonte design system complet (A1-A7) | ✅ |
| 2026-06-18 | Flow financier B1-B7 + timeline + bank deposit | ✅ |
| 2026-06-18 | Profils C1-C4 + notifications + son configurable | ✅ |
| 2026-06-18 | Query builder D1 (Contributions) + D2 (Membres + Rubriques) | ✅ |
| 2026-06-18 | Mode hors ligne F/H1 (SW + IndexedDB + sync) | ✅ |
| 2026-06-18 | Règles financières E1-E2 (simulateur + auto-calcul) | ✅ |
| 2026-06-18 | APIs externes G1-G5 + storage service S3 | ✅ |
| 2026-06-18 | H2 GED upload réel, H4 cron, H5 tests, H6 CI/CD, H7 preuve | ✅ |
| 2026-06-18 | H7 finalisé : lien "Voir preuve" dans Validations + Litiges + Contributions CONFIRME/LITIGE | ✅ |
| 2026-06-18 | DB sync : prisma db push — proofUrl + proofUploadedAt en base | ✅ |
| 2026-06-18 | H5 complété : tests/routes.test.ts (22 tests) + fix CSRF errorHandler + isolate:false | ✅ |
| 2026-06-18 | Auth tests mis à jour pour le flow CSRF réel (beforeAll fetchs /csrf-token) | ✅ |
| 2026-06-18 | CI corrigé (prisma db push + PUPPETEER_SKIP) + seed contributions 50+ démo | ✅ |
| 2026-06-18 | CSRF ForbiddenError correctement géré en 403 dans errorHandler | ✅ |
| 2026-06-18 | H8 WebSocket temps réel : socket.io API + useSocket web + broadcasts contributions | ✅ |
