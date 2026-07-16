---
description: Crée un endpoint Express complet (route, validation Zod, RBAC, audit, tests)
argument-hint: <méthode et rôle de l'endpoint>
---

Endpoint demandé : **$ARGUMENTS**

Flux backend SGM-CEM :

1. Lance `backend-lead` pour le plan. Il doit préciser :
   - routeur cible (`apps/api/src/routes/<domaine>.ts` — existant de préférence, nouveau routeur monté dans `index.ts` sinon) ;
   - schéma Zod d'entrée, modèle Prisma touché, service à créer/réutiliser ;
   - `requireRole(...)` exact (ne pas oublier DEVELOPER dans les conditions ADMIN) ;
   - `audit()` si l'action est sensible (argent, comptes, validation, suppression) ;
   - réponse `{ success: true, data }`, erreurs via `AppError(code, message, status)` ;
   - test vitest (`apps/api/tests/`) : cas nominal + au moins un cas d'erreur/RBAC.
2. Implémentation par `nano` (types partagés dans `packages/shared` si le web les consommera).
3. `builder` : type-check api + `pnpm --filter api test`.
4. `reviewer` sur le diff (grille sécurité en priorité), corrections, puis bilan :
   endpoint, rôles, exemple d'appel `curl` (penser au CSRF : `GET /api/csrf-token` d'abord).
