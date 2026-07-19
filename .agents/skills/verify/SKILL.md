---
name: verify
description: Recette de vérification end-to-end du projet SGM-CEM (API Express + web Next.js)
---

# Vérifier SGM-CEM en conditions réelles

## Lancer

- API : `cd sgm-cem/apps/api && pnpm dev` (port 3001, nodemon). Attendre `GET http://localhost:3001/api/health` → 200. Postgres local 5432 requis ; Redis facultatif.
- Web : `cd sgm-cem/apps/web && pnpm dev` (port 3000). `GET /dashboard` force la compilation de toutes les vues (elles sont importées statiquement par `app/(app)/dashboard/page.tsx`) — un 200 prouve que le module graph compile.

## Driver l'API avec curl (auth cookie + CSRF)

Tout POST/PATCH/DELETE exige le double-submit CSRF, et le jeton CSRF est LIÉ au cookie `access_token` : après un login, refetcher `/api/csrf-token` avec le jar sinon 403 CSRF_INVALID.

```bash
JAR=/tmp/jar.txt
T=$(curl -s -c "$JAR" http://localhost:3001/api/csrf-token | sed 's/.*"token":"\([^"]*\)".*/\1/')
curl -s -b "$JAR" -c "$JAR" -H "x-csrf-token: $T" -H "Content-Type: application/json" \
  -d '{"email":"admin@cem-melen.cm","password":"ChristEst!2026"}' http://localhost:3001/api/auth/login
# ensuite : GET avec -b "$JAR" ; pour un nouveau POST, refetcher le jeton CSRF d'abord
```

## Comptes seed (mot de passe commun `ChristEst!2026`)

- ADMIN : `admin@cem-melen.cm` · TRESORIER : `tresorier@cem-melen.cm`
- COLLECTEUR : `collecteur.temple@cem-melen.cm` · MEMBRE : `martine.eloundou@gmail.com`
- DEVELOPER : `devnet8057@gmail.com` (mot de passe non-seed, inconnu — tester le scope DEVELOPER autrement)

## Pièges

- `access_token` expire en 15 min : si les curl s'étalent dans le temps, « Token manquant » = expiration, pas un bug. Re-login.
- `pnpm test` (vitest) écrit dans la MÊME base Postgres que le dev — les tests laissent des données (audit logs, users de test).
- Pas de Playwright installé : la vérification UI se limite à la compilation des pages (voir ci-dessus) sauf à l'installer.
