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

echo ">>> [API] Cible PostgreSQL : host=$DB_HOST port=$DB_PORT user=$DB_USER"

# ── Attente PostgreSQL ────────────────────────────────────────────────
# Fonctionne aussi bien pour le host Docker Compose local ("postgres",
# résolu par Docker DNS, prêt en quelques secondes) que pour une base
# managée distante (timeout généreux de 120s).
echo ">>> [API] Attente de PostgreSQL..."
TIMEOUT=120
ELAPSED=0
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" > /dev/null 2>&1; do
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo ">>> [API] ❌ Timeout PostgreSQL après ${TIMEOUT}s"
    exit 1
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

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
