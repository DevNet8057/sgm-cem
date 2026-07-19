# Rapport de débogage — Connexion SGM-CEM

## Problème initial
Le frontend Next.js (`http://172.21.253.77:3000`) se chargeait mais le login échouait ou la session était perdue immédiatement après connexion.

## Causes racines

### 1. URLs API bakees en `localhost` au build
Les variables `NEXT_PUBLIC_API_URL` et `NEXT_PUBLIC_APP_URL` étaient figées à `http://localhost:3001` / `http://localhost:3000` dans le bundle Next.js. Depuis un navigateur distant (Machine A ou autre), le JS appelait `http://localhost:3001` qui pointait vers le `localhost` du **navigateur**, pas du serveur.

**Fix :**
- `apps/api/src/index.ts` — inchangé pour les URLs
- `.env` racine → ajout de `NEXT_PUBLIC_API_URL=http://172.21.253.77:3001` et `NEXT_PUBLIC_APP_URL=http://172.21.253.77:3000`
- `docker-compose.yml` → build args `NEXT_PUBLIC_API_URL` et `NEXT_PUBLIC_APP_URL` hardcodés à `http://172.21.253.77:...`
- `docker-compose.yml` → environment du service `web` et `api` mis à jour avec les mêmes IPs
- Rebuild complet via `docker compose up -d --build` (Docker Context → Machine B)

### 2. Cookie CSRF avec flag `Secure` en environnement HTTP
La configuration CSRF dans `apps/api/src/index.ts` utilisait :
```ts
secure: process.env.NODE_ENV === 'production',
```
Avec `NODE_ENV=production`, le cookie `csrf_token` était émis avec le flag `Secure`. Le navigateur refusait de sauvegarder ce cookie sur une connexion HTTP, donc la requête de login n'avait jamais de jeton CSRF valide → erreur `CSRF_INVALID`.

**Fix :** `apps/api/src/index.ts:122` — `secure: false`

### 3. Cookies `access_token` et `refresh_token` avec flag `Secure`
Même problème dans `apps/api/src/routes/auth.ts:48,56` :
```ts
secure: IS_PROD, // IS_PROD = (NODE_ENV === 'production')
```
Les deux cookies de session étaient émis avec `Secure`. Le navigateur les ignorait en HTTP → après login, la redirection vers le dashboard n'avait pas de token → l'utilisateur voyait une page déconnectée.

**Fix :** `apps/api/src/routes/auth.ts` :
- `secure: false` sur les cookies `access_token` et `refresh_token`
- `sameSite` passé de `'strict'` à `'lax'` (les cookies sont bien transmis lors des navigations HTTP normales)

## Fichiers modifiés

| Fichier | Modification |
|---------|-------------|
| `.env` | Ajout `NEXT_PUBLIC_API_URL` et `NEXT_PUBLIC_APP_URL` |
| `docker-compose.yml` | Build args + environment → IP 172.21.253.77 |
| `apps/api/src/index.ts` | CSRF cookie `secure: false` |
| `apps/api/src/routes/auth.ts` | Session cookies `secure: false`, `sameSite: 'lax'` |

## Tests de vérification

```powershell
# Frontend
curl http://172.21.253.77:3000                    → 200 OK (13986 octets)

# CSRF token
curl http://172.21.253.77:3001/api/csrf-token      → {"token":"..."}

# Login
curl -b cookies.txt -X POST http://172.21.253.77:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -d '{"email":"devnet8057@gmail.com","password":"ChristEst!2026"}'
  → {"success":true,"data":{"user":{"email":"devnet8057@gmail.com","role":"DEVELOPER"}}}

# Requête authentifiée
curl -b cookies.txt http://172.21.253.77:3001/api/membres?limit=2 → 25 membres
```

## Architecture finale

```
Machine A (dev)                    Machine B (serveur)
172.21.253.76                      172.21.253.77
       │                                  │
       │  docker context server ──────────┤ port 2376 (TLS)
       │                                  │
       │  http://172.21.253.77:3000 ──────┤ port 3000 (Next.js)
       │  http://172.21.253.77:3001 ──────┤ port 3001 (Express API)
       │                                  ├─ port 5433 (PostgreSQL)
       │                                  ├─ port 6379 (Redis)
       │                                  └─ port 9000 (Portainer)
```

## Connexion

- **URL :** `http://172.21.253.77:3000`
- **Email :** `devnet8057@gmail.com`
- **Mot de passe :** `ChristEst!2026`
