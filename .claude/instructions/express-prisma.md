# Conventions backend — Express + TypeScript + Prisma (SGM-CEM)

À lire avant tout travail dans `sgm-cem/apps/api`.

## Structure
- `src/index.ts` — app Express : middlewares globaux, montage des routeurs `/api/<domaine>`, webhooks `/webhooks` (sans `/api`), démarrage après `loadConfigCache()`.
- `src/routes/` — un routeur par domaine métier (auth, membres, rubriques, contributions, payments, collecteurs, commissions, prestations, stats, settings, notifications, profile, funds, webhooks, developer, users, audit).
- `src/services/` — logique réutilisable (yelii, cinetpay, config, receipt, financial-report…).
- `src/middleware/` — `auth`, `rbac` (`requireRole`), gestion d'erreurs.
- `src/webhooks/` — handlers signés (Yelii : HMAC-SHA512 sur le JSON re-sérialisé compact, PAS le body brut).

## Règles non négociables
1. **Config métier : `getConfig('CLE')`** (`services/config.service.ts`) — jamais `process.env.CLE` en code métier. La table `system_configs` prime, `.env` est le fallback. Appel AU MOMENT DE L'USAGE, jamais de constante figée au chargement du module (le panneau développeur doit agir sans redémarrage). Exceptions (uniquement `.env`) : `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `CSRF_SECRET`, `DATABASE_URL`.
2. **Nouvelle variable** → `.env` RACINE (celui de Docker) + `.env.example` documenté + entrée dans `prisma/seed-config.ts` si gérable au panneau développeur.
3. **Erreurs : `AppError(code, message_fr, statusHttp)`** attrapées par le errorHandler. Réponses : `{ success: true, data }` / `{ success: false, error: { code, message } }`.
4. **RBAC** : hiérarchie `DEVELOPER > ADMIN > TRESORIER > RESPONSABLE > ADJOINT_RESPONSABLE > COLLECTEUR > MEMBRE`. Piège récurrent : oublier DEVELOPER dans une condition qui teste ADMIN.
5. **`audit()` sur toute action sensible** (argent, comptes, validations, suppressions, connexions) — c'est le journal « qui a fait quoi », consultable par rôle via `/api/audit`.
6. **Validation d'entrée : Zod** en tête de handler. Montants en **FCFA entiers**. Téléphones camerounais (préfixe `+237` toléré et normalisé).
7. **CSRF** (csrf-csrf, double-submit) sur tout `/api` sauf `/webhooks/*`, `/csrf-token`, `/auth/google`. Ne jamais élargir les exemptions sans revue sécurité.
8. Rate-limit global sur `/api` ; mode maintenance évalué à chaque requête (`MAINTENANCE_MODE` en base).

## Style
- TypeScript strict, messages et commentaires en français, commentaires sobres (le « pourquoi », pas le « quoi »).
- Tests vitest dans `tests/` (supertest sur l'app exportée — `NODE_ENV=test` empêche le listen).
- Le build (`tsc`) tolère des erreurs TS historiques — ne pas en AJOUTER (comparer avant/après).
