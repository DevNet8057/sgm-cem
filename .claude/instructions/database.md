# Conventions base de données — PostgreSQL 15 + Prisma 5 (SGM-CEM)

À lire avant tout changement de `apps/api/prisma/schema.prisma` ou des seeds.

## Le point crucial : PAS de migrations
Ce projet n'a **aucun dossier `prisma/migrations`**. Le schéma s'applique par
**`prisma db push`** (idempotent) — en dev comme dans l'entrypoint Docker.
Ne jamais introduire `migrate dev`/`migrate deploy` sans décision explicite de migrer
tout le workflow (et un plan pour les bases existantes).

## Workflow d'un changement de schéma
1. Modifier `schema.prisma`.
2. Évaluer l'impact sur les **données existantes** (volume Docker `pgdata` = données réelles) :
   `db push` refuse les changements destructeurs — c'est un signal d'alarme, pas un obstacle à contourner avec `--accept-data-loss`.
3. `pnpm --filter api exec prisma db push` puis `prisma generate`.
4. Adapter les seeds si besoin — ils doivent rester **idempotents** (upsert, `update: {}` pour ne pas écraser) : ils peuvent être rejoués sur une base pleine sans dégât.
5. En conteneur : redémarrer l'api suffit (l'entrypoint refait `db push` à chaque boot).

## Seeds
- `prisma/seed.ts` — comptes (admin depuis `ADMIN_EMAIL`/`ADMIN_PASSWORD`), 11 rubriques, membres et contributions de démo. Exécuté automatiquement par l'entrypoint Docker **seulement si la base est vide** (0 utilisateur).
- `prisma/seed-config.ts` — copie les valeurs `.env` vers `system_configs` (n'écrase JAMAIS une valeur en base) + élève `ADMIN_EMAIL` au rôle DEVELOPER. À relancer après ajout d'une clé de config : `docker exec sgm-cem-api-1 sh -c 'cd /app/apps/api && pnpm exec ts-node prisma/seed-config.ts'`.

## Conventions de modèle
- Identifiants membres : format `CEM-<année>-<numéro à 6 chiffres>`.
- Montants : **FCFA entiers** (jamais de décimaux).
- Enums métier existants (catégories, groupes, statuts, profils financiers, rôles) : réutiliser, ne pas créer de variantes.
- `system_configs` : clés en SCREAMING_SNAKE_CASE, catégorie (`ConfigCategory`), `isSecret` pour les clés API.

## Sécurité données
- Ne jamais exécuter `docker compose down -v` ni `prisma db push --force-reset` (destruction des données) sans accord explicite de l'utilisateur.
- Sauvegarde avant opération risquée : `docker exec sgm-cem-postgres-1 pg_dump -U postgres sgm_cem > backup_$(date +%Y%m%d).sql`.
