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

# Le projet n'a pas de dossier prisma/migrations (schéma appliqué via db push
# en dev) : `migrate deploy` ne créerait AUCUNE table. `db push` synchronise
# le schéma de façon idempotente sans perte de données.
# Note : `prisma generate` est déjà exécuté au build (Dockerfile étape 7),
# donc on utilise --skip-generate pour gagner ~3s au démarrage.
echo ">>> [API] Synchronisation du schéma Prisma (db push)..."
pnpm exec prisma db push --skip-generate

# Seed uniquement si la base est vide (aucun utilisateur) : sans lui, aucun
# compte admin n'existe et la connexion est impossible au premier démarrage.
USERS=$(node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.count().then(c=>console.log(c)).catch(()=>console.log('ERR')).finally(()=>p.\$disconnect())")
if [ "$USERS" = "0" ]; then
  echo ">>> [API] Base vide — seed initial (comptes + rubriques + config)..."
  pnpm exec ts-node prisma/seed.ts
  pnpm exec ts-node prisma/seed-config.ts
else
  echo ">>> [API] Base déjà peuplée ($USERS utilisateurs) — seed ignoré."
fi

echo ">>> [API] Lancement du serveur..."
exec node dist/index.js
