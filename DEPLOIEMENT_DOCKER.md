# Déploiement Docker — SGM-CEM

> **⚠️ LECTURE OBLIGATOIRE** avant toute tâche touchant au déploiement, aux Dockerfiles,
> aux variables d'environnement ou à la configuration. Référencé par `CLAUDE.md`.
> Dernière mise à jour : 2026-07-16 — déploiement vérifié fonctionnel de bout en bout.

## Avant toute mise à jour : sauvegarder la base

```powershell
cd sgm-cem
powershell -ExecutionPolicy Bypass -File .\scripts\backup-db.ps1   # Windows
./scripts/backup-db.sh                                               # Linux/macOS
```
Le script produit `backups/sgm_cem_<date>.dump` (vérifié, non versionné). L'API prend en plus
une sauvegarde automatique au démarrage (volume `dbbackups`) avant toute évolution de schéma.

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
| web      | build `apps/web`     | 3000 | Next.js 16 en mode production |

Ordre de démarrage géré par les healthchecks : postgres/redis → api → web.

## Les 8 pièges de ce projet (découverts et corrigés le 2026-07-15/16)

### 1. Deux fichiers `.env` — LE piège n°1
- `sgm-cem/.env` (racine) : **le seul lu par Docker** (`env_file` du compose).
- `sgm-cem/apps/api/.env` : utilisé uniquement quand l'API tourne directement sur Windows (dev).

**Toute nouvelle clé API va dans le `.env` RACINE**, puis :
```bash
docker compose up -d --force-recreate api
docker exec sgm-cem-api-1 sh -c 'cd /app/apps/api && node_modules/.bin/ts-node prisma/seed-config.ts'
```
Incident réel : Yelii, CinetPay et le web push (VAPID) étaient silencieusement cassés en
conteneur car leurs clés n'existaient que dans `apps/api/.env` (7 variables rapatriées).

### 2. Migrations Prisma versionnées (depuis le 17/10/2026)
L'entrypoint sauvegarde la base puis lance `prisma migrate deploy`
(`apps/api/prisma/migrations`). Une base créée autrefois par `db push` est adoptée
**une fois** automatiquement : le SQL d'alignement (`migrate diff`) est appliqué en une
transaction, et le démarrage s'arrête **sans rien modifier** s'il contient une
suppression (`DROP TABLE/COLUMN/TYPE`, `TRUNCATE`, `DELETE`). Ligne de base ensuite
marquée appliquée. Tout changement de schéma passe par `prisma migrate dev --name …`
et doit être **idempotent** (`IF NOT EXISTS`) : une base adoptée possède déjà les
colonnes récentes (voir `.claude/instructions/database.md`).

### 3. Seed automatique conditionnel
L'entrypoint (`apps/api/docker-entrypoint.sh`) seed la base **uniquement si
`user.count() == 0`** : `seed.ts` (admin, paramètres, 11 rubriques, GED) puis
`seed-config.ts` (table `system_configs`, idempotent — n'écrase jamais).
Les données de **démonstration** (comptes fictifs, contributions) ne sont créées
qu'avec `SEED_DEMO=1`. Les redémarrages ne touchent jamais aux données existantes.

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
En local, Yelii ne peut pas joindre `localhost` → pas de confirmation temps réel.
Filets de sécurité vérifiés : la page `/payment/return` polle le statut 60 s, et le cron
de réconciliation repasse toutes les 10 min. Pour du temps réel : VPS + domaine
(ou tunnel Cloudflare **nommé** — les tunnels `trycloudflare.com` sont éphémères,
celui utilisé en dev est mort).

### 8bis. DEUX PostgreSQL sur cette machine — piège majeur (découvert le 2026-07-17)
Un PostgreSQL **natif Windows** (service `postgresql-x64-18`) tourne sur le port 5432
EN PLUS du conteneur. Depuis l'hôte, `localhost:5432` = le **natif** (base de dev
historique — c'est là qu'écrivent les tests vitest et tout `prisma db push` lancé
depuis l'hôte) ; les conteneurs, eux, se parlent par le réseau Docker interne
(`postgres:5432` = le conteneur). Les deux bases s'appellent `sgm_cem` et **divergent**.
- Vérifier la base du CONTENEUR : `docker exec sgm-cem-postgres-1 psql -U postgres -d sgm_cem …`
- Le schéma du conteneur est mis à jour par l'entrypoint (`migrate deploy`) à chaque
  redémarrage de l'api — une migration appliquée côté hôte ne suffit PAS pour le conteneur.
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

Aucun mot de passe n'est écrit dans le code (phase 0, 17/10/2026).
- Admin : `ADMIN_EMAIL` (défaut `devnet8057@gmail.com`). Mot de passe = `ADMIN_PASSWORD`
  s'il est fourni ; sinon un mot de passe **aléatoire** est affiché **une seule fois**
  dans les journaux du premier démarrage (`docker compose logs api`) et doit être changé
  à la première connexion.
- Démo (`SEED_DEMO=1` seulement) : 5 comptes staff + membres fictifs ; mot de passe commun
  `SEED_DEMO_PASSWORD` ou aléatoire affiché dans les journaux.
- Compte perdu : `docker exec -e TARGET_EMAIL=… sgm-cem-api-1 sh -c 'cd /app/apps/api && node_modules/.bin/ts-node prisma/reset-admin-password.ts'`
  (mot de passe temporaire aléatoire, sessions fermées, action journalisée).
- Comptes encore sur un ancien mot de passe commun : `docker exec -e CANDIDATE_PASSWORDS='ancien1|ancien2' sgm-cem-api-1 sh -c 'cd /app/apps/api && node_modules/.bin/ts-node prisma/audit-default-passwords.ts'`
  (liste seulement ; `-e FORCE_CHANGE=1` impose le changement, sur décision du Bureau).

## Tâches planifiées (réconciliation, grand livre, relevés, purge)
Catalogue unique : `apps/api/src/jobs/scheduler.ts`. Avec Redis (`REDIS_URL`), planificateurs
BullMQ : **une seule exécution par échéance**, même avec plusieurs processus. Ce compose les
exécute dans l'API ; la production les confie au service `worker` (`node dist/worker.js`,
même image) avec `RUN_SCHEDULED_JOBS=false` sur l'API (voir `deploy/docker-compose.prod.yml`).

## Variables de sécurité vérifiées au démarrage (NODE_ENV=production)
L'API **refuse de démarrer** si l'une manque ou fait moins de 32 caractères :
`JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `CSRF_SECRET`, `CONFIG_ENCRYPTION_KEY` (générer : `openssl rand -base64 48`).
`CONFIG_ENCRYPTION_KEY` chiffre les secrets d'intégration stockés en base (Yelii, CinetPay, SMTP…) :
**la conserver hors du serveur** ; perdue, ces clés sont à ressaisir dans le panneau développeur.
Rotation : mettre l'ancienne dans `CONFIG_ENCRYPTION_KEY_PREVIOUS`, redémarrer (rechiffrement automatique), puis la retirer.
`TRUST_PROXY` : `0` quand l'API est exposée directement (ce compose), `1` derrière Caddy.

## Vérification Docker du 18/10/2026 (branche `claude/ecstatic-gates-g8pt2c`)
Démarrage complet sur une base neuve : `postgres`, `redis`, `gotenberg`, `api`, `web` en bonne santé,
10 migrations appliquées, seed de démonstration, API sans droits root, parcours navigateur sans erreur
serveur, PDF (Gotenberg) et export Excel produits, **0 écart** au contrôle du grand livre.
- **Corrigé** : sur base neuve le seed de démonstration passe après la migration du grand livre ;
  `prisma/seed.ts` inscrit désormais la position de départ des contributions confirmées (sinon 66 écarts).
- **À savoir** : `docker-compose.yml` code en dur l'IP du poste de développement (`172.21.253.77`)
  dans `APP_URL`, `API_URL` et `NEXT_PUBLIC_*` — à remplacer par l'adresse du poste ou `localhost`
  (les `NEXT_PUBLIC_*` sont figées au build de l'image web : reconstruire après changement).
- Détail, et ce qui reste à faire : [`docs/pilotage/08_RESTE_A_FAIRE.md`](docs/pilotage/08_RESTE_A_FAIRE.md).

## Mise en production (prochaine étape décidée : à faire)

1. VPS (Hetzner/Contabo/OVH ~5-10 €/mois) + nom de domaine.
2. Installer Docker, copier le projet + `.env` racine (jamais via git — il est ignoré).
3. Ajuster `.env` : `APP_URL`, `API_URL`, `NEXT_PUBLIC_API_URL` → domaine public.
4. Reverse proxy (Caddy recommandé : HTTPS automatique) devant web:3000 et api:3001.
5. Google Cloud Console → OAuth → ajouter le domaine aux « Authorized JavaScript origins »
   (le 403 Google actuel vient de là).
6. Mettre à jour `YELII_WEBHOOK_URL` (panneau développeur) → `https://<domaine>/webhooks/yelii`.
7. Sauvegardes : `pg_dump` planifié du volume `pgdata` (à mettre en place).
