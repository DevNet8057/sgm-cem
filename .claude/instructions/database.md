# Conventions base de données — PostgreSQL 15 + Prisma 7 (SGM-CEM)

À lire avant tout changement de `apps/api/prisma/schema.prisma` ou des seeds.

## Le point crucial : migrations versionnées (depuis le 17/10/2026)
Le schéma s'applique par **`prisma migrate deploy`** (dossier `prisma/migrations`,
ligne de base `0_baseline`). L'entrypoint Docker sauvegarde la base, puis applique
les migrations. Une base créée autrefois par `db push` est **adoptée une seule
fois** automatiquement (`migrate diff` appliqué en transaction, refusé s'il contient
une suppression, puis `migrate resolve --applied 0_baseline`). Conséquence : toute
nouvelle migration DDL s'écrit **idempotente** (`ADD COLUMN IF NOT EXISTS`,
`CREATE [UNIQUE] INDEX IF NOT EXISTS`) car une base adoptée a déjà le schéma courant.
La CI échoue si `schema.prisma` et les migrations divergent.

## Prisma 7 (depuis le 17/10/2026)
- L'URL de connexion est dans **`apps/api/prisma.config.ts`** (plus dans `schema.prisma`) ;
  `prisma migrate dev` a besoin de `SHADOW_DATABASE_URL` (base jetable).
- Tout client passe par **`getPrisma()`** (`src/lib/prisma.ts`, adaptateur `@prisma/adapter-pg`) ;
  scripts : `createPrismaClient()`. Jamais `new PrismaClient()` ailleurs : chaque client ouvre
  sa propre réserve de connexions PostgreSQL.
- `migrate diff` : `--from-config-datasource` / `--to-schema prisma/schema.prisma`
  (`--from-url` et `--to-schema-datamodel` n'existent plus).

## Workflow d'un changement de schéma
1. Modifier `schema.prisma` — changements **additifs** de préférence (colonne nullable, nouvelle table).
2. Créer la migration sur une base de dev jetable :
   `pnpm --filter api exec prisma migrate dev --name <nom_en_snake_case>` ; relire le SQL généré.
3. Données existantes (volume `pgdata` = données réelles) : jamais de suppression de
   colonne/table ni de contrainte qui échouerait sur l'existant sans plan validé par l'utilisateur.
   Une reprise de données = migration SQL **idempotente** (rejouable sans effet).
4. Adapter les seeds si besoin — ils doivent rester **idempotents** (upsert, `update: {}`).
5. En conteneur : redémarrer l'api (sauvegarde automatique puis `migrate deploy`).

## Seeds
- `prisma/seed.ts` — admin (`ADMIN_EMAIL` ; `ADMIN_PASSWORD` ou mot de passe aléatoire affiché une fois), paramètres, 11 rubriques ; comptes et contributions de démonstration **seulement avec `SEED_DEMO=1`**. Exécuté automatiquement par l'entrypoint Docker **seulement si la base est vide** (0 utilisateur).
- `prisma/seed-config.ts` — copie les valeurs `.env` vers `system_configs` (n'écrase JAMAIS une valeur en base) + élève `ADMIN_EMAIL` au rôle DEVELOPER. À relancer après ajout d'une clé de config : `docker exec sgm-cem-api-1 sh -c 'cd /app/apps/api && node_modules/.bin/ts-node prisma/seed-config.ts'`.

## Conventions de modèle
- Identifiants membres : format `CEM-<année>-<numéro à 6 chiffres>`.
- Montants : **FCFA entiers** (jamais de décimaux).
- Enums métier existants (catégories, groupes, statuts, profils financiers, rôles) : réutiliser, ne pas créer de variantes.
- `system_configs` : clés en SCREAMING_SNAKE_CASE, catégorie (`ConfigCategory`), `isSecret` pour les clés API.

## Sécurité données
- Ne jamais exécuter `docker compose down -v`, `prisma db push --force-reset`, `prisma migrate reset` ni `--accept-data-loss` (destruction des données) sans accord explicite de l'utilisateur.
- Sauvegarde avant opération risquée : `sgm-cem/scripts/backup-db.ps1` (ou `.sh`) — l'API en prend aussi une automatiquement à chaque démarrage.
