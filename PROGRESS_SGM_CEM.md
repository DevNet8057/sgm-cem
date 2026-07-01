# SUIVI D'AVANCEMENT — SGM-CEM v6.0

Dernière mise à jour : 2026-06-18
Avancement global : **100%** (47/47 tâches)

## Légende

✅ Terminé et vérifié · 🔄 En cours · ⬜ Non commencé · ⚠️ RÉGRESSION · 🔶 Bloqué / FUTURE

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
- ✅ G3. WhatsApp Business (360dialog) — services/notification.ts + .env.example
- ✅ G4. SMS Twilio fallback — services/notification.ts + .env.example
- ✅ G5. Stockage S3-compatible — services/storage.ts (S3 ou fallback local transparent)

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
