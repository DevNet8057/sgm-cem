# Déploiement Docker — SGM-CEM

> **⚠️ LECTURE OBLIGATOIRE** avant toute tâche touchant au déploiement, aux Dockerfiles,
> aux variables d'environnement ou à la configuration. Référencé par `CLAUDE.md`.
> Dernière mise à jour : 2026-07-22 — correctifs paiements Mobile Money (§7/§7bis).
> Déploiement Docker local vérifié fonctionnel de bout en bout depuis le 2026-07-16.
> **Migration prévue : Docker → AWS** (cible actuelle, remplace l'hypothèse VPS
> générique ci-dessous — mettre à jour la section « Mise en production » dès que les
> choix AWS concrets (EC2 vs ECS/Fargate, RDS vs Postgres conteneurisé, etc.) sont
> arrêtés, ne pas improviser de détails non décidés).

## Démarrage rapide

```bash
cd sgm-cem
docker compose up -d          # lance postgres + redis + api (3001) + web (3000)
docker compose ps             # les 4 services doivent être "healthy"
docker compose logs -f api    # suivre les logs API
docker compose up -d --build  # redéployer après modification du code
```

- Web : http://localhost:3000 — API : http://localhost:3001/api/health
- Les données vivent dans les volumes `pgdata` (PostgreSQL) et `redisdata`.
  `docker compose down` les préserve ; `down -v` les **détruit** (jamais sans accord explicite).

## Architecture conteneurisée

| Service  | Image                | Port | Rôle |
|----------|----------------------|------|------|
| postgres | postgres:15-alpine   | 5432 | Base de données (volume `pgdata`) |
| redis    | redis:7-alpine       | 6379 | Cache + BullMQ |
| api      | build `apps/api`     | 3001 | Express + Prisma + Puppeteer (Chromium système) |
| web      | build `apps/web`     | 3000 | Next.js 15 en mode production |

Ordre de démarrage géré par les healthchecks : postgres/redis → api → web.

## Les 8 pièges de ce projet (découverts et corrigés le 2026-07-15/16)

### 1. Deux fichiers `.env` — LE piège n°1
- `sgm-cem/.env` (racine) : **le seul lu par Docker** (`env_file` du compose).
- `sgm-cem/apps/api/.env` : utilisé uniquement quand l'API tourne directement sur Windows (dev).

**Toute nouvelle clé API va dans le `.env` RACINE**, puis :
```bash
docker compose up -d --force-recreate api
docker exec sgm-cem-api-1 sh -c 'cd /app/apps/api && pnpm exec ts-node prisma/seed-config.ts'
```
Incident réel : Yelii, CinetPay et le web push (VAPID) étaient silencieusement cassés en
conteneur car leurs clés n'existaient que dans `apps/api/.env` (7 variables rapatriées).

### 2. Pas de migrations Prisma — `db push`, pas `migrate deploy`
Le projet n'a **aucun dossier `prisma/migrations`**. L'entrypoint Docker fait
`prisma db push` (idempotent). `migrate deploy` ne créerait **aucune table**.

### 3. Seed automatique conditionnel
L'entrypoint (`apps/api/docker-entrypoint.sh`) seed la base **uniquement si
`user.count() == 0`** : `seed.ts` (comptes, 11 rubriques, données démo) puis
`seed-config.ts` (table `system_configs`, idempotent — n'écrase jamais).
Les redémarrages ne touchent donc jamais aux données existantes.

### 4. La config à l'exécution vient de la BASE, pas du `.env`
`getConfig()` (config.service.ts) lit : cache DB (`system_configs`) → fallback `process.env`.
Une valeur changée dans `.env` ne prend effet que si la clé est ABSENTE de la base ;
sinon il faut la modifier via le **panneau développeur** (ou `seed-config` pour les nouvelles clés).
Exceptions (jamais en base) : `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `CSRF_SECRET`, `DATABASE_URL`.

### 5. `NEXT_PUBLIC_*` figées au BUILD du web
Next.js inline ces variables au `next build`. Elles passent par `build.args` dans
`docker-compose.yml` (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` ← `GOOGLE_CLIENT_ID` du `.env` racine).
**Changer l'URL publique ⇒ `docker compose build web` obligatoire.**

### 6. Monorepo pnpm : `packages/shared` doit précéder l'install
Les Dockerfiles copient `packages/shared` (package.json + tsconfig + src) AVANT
`pnpm install --filter <app>...` — le postinstall racine compile shared. Ne pas "simplifier".

### 7. Webhooks Yelii : route `/webhooks/yelii` (SANS préfixe `/api`)
En local, Yelii ne peut pas joindre `localhost` → pas de confirmation temps réel par webhook.
**Depuis le 2026-07-22, ce n'est plus bloquant** : `GET /api/payments/status/:id` (pollé
toutes les 5 s par le frontend pendant l'attente d'un paiement Mobile Money) vérifie
maintenant activement le statut chez Yelii lui-même (`payment-sync.service.ts`) au lieu
de se contenter de lire la base — la confirmation ou l'échec réel remonte en quelques
secondes, avec ou sans webhook. Le cron de réconciliation (`payment-reconciliation.ts`,
seuil réduit de 15 min à **1 min**, fréquence dynamique via panneau développeur
`RECONCILIATION_INTERVAL_MINUTES`, défaut 10 min) ne sert plus que de filet de secours
si l'utilisateur ferme l'onglet avant confirmation. Pour un webhook temps réel malgré
tout (recommandé en prod, réduit la charge de polling) : VPS + domaine (ou tunnel
Cloudflare **nommé** — les tunnels `trycloudflare.com` sont éphémères, celui utilisé
en dev est mort).

### 7bis. Fuite de process Puppeteer — corrigée le 2026-07-22
`generateReceiptPdf` (génération du reçu PDF) ne fermait pas le navigateur headless
Chromium si la génération échouait en cours de route (`browser.close()` jamais atteint
faute de `try/finally`). Sur un conteneur de longue durée générant beaucoup de reçus,
ça finissait par épuiser les ressources et faire échouer TOUTE génération de reçu —
symptôme observé : `SERVER_ERROR` systématique après plusieurs heures d'utilisation,
résolu par un simple redémarrage (qui masquait le vrai problème). Corrigé avec un
`try/finally` garantissant la fermeture du navigateur dans tous les cas — si ce
symptôme réapparaît malgré le correctif, vérifier `tasklist`/`ps aux | grep chrome`
pour des process Chromium orphelins avant de conclure à autre chose.

### 8bis. DEUX PostgreSQL sur cette machine — piège majeur (découvert le 2026-07-17)
Un PostgreSQL **natif Windows** (service `postgresql-x64-18`) tourne sur le port 5432
EN PLUS du conteneur. Depuis l'hôte, `localhost:5432` = le **natif** (base de dev
historique — c'est là qu'écrivent les tests vitest et tout `prisma db push` lancé
depuis l'hôte) ; les conteneurs, eux, se parlent par le réseau Docker interne
(`postgres:5432` = le conteneur). Les deux bases s'appellent `sgm_cem` et **divergent**.
- Vérifier la base du CONTENEUR : `docker exec sgm-cem-postgres-1 psql -U postgres -d sgm_cem …`
- Le schéma du conteneur est resynchronisé par l'entrypoint (`db push`) à chaque
  redémarrage de l'api — un `db push` hôte ne suffit PAS pour le conteneur.
- Ne jamais comparer des comptages entre les deux sans savoir lequel on interroge.

### 8. Divers appris à la dure
- `.dockerignore` : motifs avec `**/` (`**/node_modules`) — sans ça, seuls ceux de la racine sont exclus.
- `useSearchParams()` sans `<Suspense>` casse `next build` (prod uniquement, jamais en dev) — corrigé sur `/payment/return`, à respecter sur toute nouvelle page.
- Disque C: de la machine chroniquement plein : un build qui échoue en
  **« read-only file system »** = VHD Docker qui ne peut plus grandir.
  Remède : `npm cache clean --force`, `wsl --shutdown` (compacte le VHD), relancer Docker Desktop, `docker builder prune -f`.
- L'entrypoint doit rester en fins de ligne **LF** (le Dockerfile applique `sed -i 's/\r$//'` par sécurité).
- Healthcheck API : `/api/health` (pas `/health`).

## Comptes seedés (base neuve uniquement)

Admin : `devnet8057@gmail.com` + 5 comptes staff de démo (mot de passe commun de seed —
**à changer avant toute utilisation réelle**, voir `ADMIN_PASSWORD` dans `.env`).

## Mise en production (prochaine étape décidée : migration vers AWS — détails à préciser)

Cible confirmée : **AWS**, après ce déploiement Docker local. Les points ci-dessous
restent valables tels quels (image Docker déjà construite, ne change pas selon
l'hébergeur) ; seuls le choix du service de calcul (EC2 simple vs ECS/Fargate) et
du service de base de données (Postgres conteneurisé vs RDS managé) restent à
arbitrer — ne pas présumer d'un choix précis tant qu'il n'a pas été décidé
explicitement, les compléter ici une fois tranchés.

1. VPS générique (Hetzner/Contabo/OVH) OU instance EC2 AWS équivalente, + nom de domaine.
2. Installer Docker, copier le projet + `.env` racine (jamais via git — il est ignoré).
3. Ajuster `.env` : `APP_URL`, `API_URL`, `NEXT_PUBLIC_API_URL` → domaine public.
4. Reverse proxy (Caddy recommandé : HTTPS automatique) devant web:3000 et api:3001.
5. Google Cloud Console → OAuth → ajouter le domaine aux « Authorized JavaScript origins »
   (le 403 Google actuel vient de là).
6. Mettre à jour `YELII_WEBHOOK_URL` (panneau développeur) → `https://<domaine>/webhooks/yelii`.
7. Sauvegardes : `pg_dump` planifié du volume `pgdata` (à mettre en place).
