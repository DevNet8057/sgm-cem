# Conventions de conception API — REST SGM-CEM

À lire avant de créer ou modifier un endpoint.

## Contrat de réponse (uniforme, sans exception)
```jsonc
// Succès
{ "success": true, "data": { /* payload */ } }
// Erreur (produite par AppError + errorHandler)
{ "success": false, "error": { "code": "VALIDATION", "message": "Message en français" } }
```
Codes d'erreur usuels : `VALIDATION` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404), `MAINTENANCE` (503). Les messages sont destinés à l'utilisateur final → français, actionnables.

## Routage
- Endpoints métier : `/api/<domaine>` (pluriel : `/api/membres`, `/api/contributions`…), routeur dédié dans `src/routes/`, monté dans `index.ts`.
- **Webhooks entrants : `/webhooks/<fournisseur>` SANS préfixe `/api`** (hors CSRF et rate-limit API). Toujours vérifier la signature AVANT tout traitement (Yelii : HMAC-SHA512 de `timestamp + JSON compact`, anti-replay 5 min).
- Verbes : GET lecture, POST création/action, PATCH modification partielle, DELETE suppression (souvent logique — `isActive: false` — plutôt que physique, pour l'audit).

## Checklist de tout nouvel endpoint
1. Auth + `requireRole(...)` — quel est le rôle MINIMAL ? (et DEVELOPER passe partout où ADMIN passe).
2. Validation **Zod** du body/params/query en tête de handler.
3. `audit()` si l'action touche argent, comptes, validations ou suppressions.
4. Pagination pour toute liste potentiellement longue (`page`/`limit`, retourner le total).
5. Idempotence des actions de paiement (un webhook peut être rejoué — vérifier l'état avant de re-créditer).
6. Test vitest : cas nominal + refus RBAC + entrée invalide.

## Spécificités transverses
- CSRF : le client web récupère `GET /api/csrf-token` puis envoie le header — `@/lib/api` le gère ; tout consommateur externe (curl, scripts) doit le faire aussi.
- Rate-limit global sur `/api` — les endpoints très sollicités (polling de statut de paiement) doivent rester légers.
- Mode maintenance (`MAINTENANCE_MODE` en base) : bloque tout `/api` sauf auth, developer, csrf-token, health — un nouvel endpoint « d'administration vitale » doit figurer dans ces exceptions s'il doit rester joignable.
- Temps réel : les événements notifiables passent par Socket.IO (voir usages existants) en plus de la table notifications.
