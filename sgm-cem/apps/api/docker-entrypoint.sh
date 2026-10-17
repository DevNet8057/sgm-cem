#!/bin/sh
set -e
cd /app/apps/api

# ── Parsing robuste de DATABASE_URL (une seule invocation Node) ───────
# Node.js gère correctement les @ dans les mots de passe, les IPv6,
# les caractères spéciaux encodés, etc. — là où sed/awk échouent.
DB_PARSED=$(node -e "
try {
  const u = new URL(process.env.DATABASE_URL)
  console.log([u.hostname, u.port||'5432', decodeURIComponent(u.username)||'postgres'].join('|'))
} catch { console.log('localhost|5432|postgres') }
")
DB_HOST=$(echo "$DB_PARSED" | cut -d'|' -f1)
DB_PORT=$(echo "$DB_PARSED" | cut -d'|' -f2)
DB_USER=$(echo "$DB_PARSED" | cut -d'|' -f3)

# Détection du contexte : Docker local (host=postgres) vs Render managed
# Le host « postgres » est résolu par Docker DNS. Tout autre host
# (y compris les FQDN Render comme xxx.oregon-postgres.render.com)
# indique un service managé distant.
case "$DB_HOST" in
  localhost|postgres|127.0.0.1) IS_RENDER=0 ;;
  *) IS_RENDER=1 ;;
esac

echo ">>> [API] Contexte détecté : host=$DB_HOST port=$DB_PORT user=$DB_USER (Render=$IS_RENDER)"

# ── Attente PostgreSQL ────────────────────────────────────────────────
# Sur Render, la base managed est distante — on attend avec un timeout.
# En Docker local, le host "postgres" est résolu par Docker DNS.
if [ "$IS_RENDER" -eq 1 ]; then
  echo ">>> [API] Attente de PostgreSQL (Render managed, timeout 120s)..."
  TIMEOUT=120
  ELAPSED=0
  until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" > /dev/null 2>&1; do
    if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
      echo ">>> [API] ❌ Timeout PostgreSQL après ${TIMEOUT}s"
      exit 1
    fi
    sleep 3
    ELAPSED=$((ELAPSED + 3))
  done
else
  echo ">>> [API] Attente de PostgreSQL (Docker local)..."
  until pg_isready -h postgres -p 5432 -U postgres > /dev/null 2>&1; do
    sleep 2
  done
fi

echo ">>> [API] ✅ PostgreSQL prêt"

# ── Sauvegarde automatique AVANT toute modification de schéma ─────────
# Une base déjà peuplée est sauvegardée (pg_dump -Fc) dans le volume
# « dbbackups » avant la synchronisation du schéma. Sans sauvegarde
# réussie, le démarrage s'arrête : aucune évolution de schéma sans filet.
# Contournement explicite (déconseillé) : SKIP_PRE_START_BACKUP=1.
BACKUP_DIR=/app/apps/api/backups
PG_URL="${DATABASE_URL%%\?*}"   # libpq refuse les paramètres Prisma (?schema=…)
HAS_DATA=$(psql "$PG_URL" -tAc "select to_regclass('public.users') is not null" 2>/dev/null || echo "f")
if [ "$HAS_DATA" = "t" ] && [ "${SKIP_PRE_START_BACKUP:-0}" != "1" ]; then
  mkdir -p "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/pre-start_$(date -u +%Y%m%dT%H%M%SZ).dump"
  echo ">>> [API] Sauvegarde préalable de la base → $BACKUP_FILE"
  if pg_dump "$PG_URL" -Fc --no-owner -f "$BACKUP_FILE" && pg_restore --list "$BACKUP_FILE" > /dev/null; then
    echo ">>> [API] ✅ Sauvegarde vérifiée"
    # Conserver les 10 sauvegardes de démarrage les plus récentes
    ls -1t "$BACKUP_DIR"/pre-start_*.dump 2>/dev/null | tail -n +11 | xargs -r rm -f
  else
    echo ">>> [API] ❌ Sauvegarde préalable impossible — démarrage interrompu (aucune modification de schéma)."
    exit 1
  fi
fi

# ── Schéma : migrations Prisma versionnées (prisma/migrations) ──────────
# Base créée autrefois par `db push` (tables présentes, pas de table
# _prisma_migrations) : adoption UNE fois. Le SQL d'alignement sur le schéma
# courant est calculé (migrate diff) puis appliqué en une transaction, SAUF
# s'il contient une instruction destructive : démarrage interrompu, rien
# n'est modifié. (`db push` n'est plus utilisé : il refuse aussi des ajouts
# sans risque, comme un index unique sur une colonne neuve.) La ligne de base
# est ensuite marquée appliquée ; les migrations suivantes, idempotentes,
# passent avec `migrate deploy` comme pour toute base neuve.
HAS_MIGRATIONS=$(psql "$PG_URL" -tAc "select to_regclass('public._prisma_migrations') is not null" 2>/dev/null || echo "f")
if [ "$HAS_DATA" = "t" ] && [ "$HAS_MIGRATIONS" != "t" ]; then
  echo ">>> [API] Base existante sans historique de migrations — adoption de la ligne de base..."
  ADOPT_SQL=$(mktemp)
  node_modules/.bin/prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > "$ADOPT_SQL"
  if grep -Eiq 'DROP (TABLE|COLUMN|TYPE|SCHEMA)|TRUNCATE|DELETE FROM' "$ADOPT_SQL"; then
    echo ">>> [API] ❌ L'alignement du schéma supprimerait des données — démarrage interrompu, base inchangée."
    grep -Ei 'DROP (TABLE|COLUMN|TYPE|SCHEMA)|TRUNCATE|DELETE FROM' "$ADOPT_SQL"
    exit 1
  fi
  psql "$PG_URL" -v ON_ERROR_STOP=1 --single-transaction -q -f "$ADOPT_SQL"
  rm -f "$ADOPT_SQL"
  node_modules/.bin/prisma migrate resolve --applied 0_baseline
fi
echo ">>> [API] Application des migrations (migrate deploy)..."
node_modules/.bin/prisma migrate deploy

# Seed uniquement si la base est vide (aucun utilisateur) : sans lui, aucun
# compte admin n'existe et la connexion est impossible au premier démarrage.
USERS=$(node -e "const{PrismaClient}=require('@prisma/client');const{PrismaPg}=require('@prisma/adapter-pg');const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});p.user.count().then(c=>console.log(c)).catch(()=>console.log('ERR')).finally(()=>p.\$disconnect())")
if [ "$USERS" = "0" ]; then
  # Seed de BASE (admin, paramètres, rubriques, config) — jamais de données de
  # démonstration sauf SEED_DEMO=1 explicite.
  echo ">>> [API] Base vide — seed initial (admin + rubriques + config)..."
  node_modules/.bin/ts-node prisma/seed.ts
  node_modules/.bin/ts-node prisma/seed-config.ts
else
  echo ">>> [API] Base déjà peuplée ($USERS utilisateurs) — seed ignoré."
fi

# ── Serveur sans privilèges root (lot 3) ──────────────────────────────
# Lancé en root (Compose de développement, volumes existants) : les dossiers
# écrits par l'application sont rendus à l'utilisateur node, puis le serveur
# démarre sous node. Lancé directement en node (Compose de production) : rien à faire.
echo ">>> [API] Lancement du serveur..."
if [ "$(id -u)" = "0" ]; then
  mkdir -p uploads backups
  chown -R node:node uploads backups
  exec setpriv --reuid=node --regid=node --init-groups -- node dist/index.js
fi
exec node dist/index.js
