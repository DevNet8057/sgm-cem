#!/bin/sh
set -e

echo ">>> [API] Attente de PostgreSQL..."
# Attend que PostgreSQL soit prêt via pg_isready
# (le healthcheck du service postgres garantit qu'il est opérationnel)
until pg_isready -h postgres -p 5432 -U postgres > /dev/null 2>&1; do
  sleep 2
done

echo ">>> [API] Exécution des migrations Prisma…"
pnpm --filter api exec prisma migrate deploy

echo ">>> [API] Lancement du serveur…"
pnpm --filter api start
