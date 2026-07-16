#!/bin/sh
set -e
cd /app/apps/api

echo ">>> [API] Attente de PostgreSQL..."
until pg_isready -h postgres -p 5432 -U postgres > /dev/null 2>&1; do
  sleep 2
done

# Le projet n'a pas de dossier prisma/migrations (schéma appliqué via db push
# en dev) : `migrate deploy` ne créerait AUCUNE table. `db push` synchronise
# le schéma de façon idempotente sans perte de données.
echo ">>> [API] Synchronisation du schéma Prisma (db push)…"
pnpm exec prisma db push --skip-generate

# Seed uniquement si la base est vide (aucun utilisateur) : sans lui, aucun
# compte admin n'existe et la connexion est impossible au premier démarrage.
USERS=$(node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.count().then(c=>console.log(c)).catch(()=>console.log('ERR')).finally(()=>p.\$disconnect())")
if [ "$USERS" = "0" ]; then
  echo ">>> [API] Base vide — seed initial (comptes + rubriques + config)…"
  pnpm exec ts-node prisma/seed.ts
  pnpm exec ts-node prisma/seed-config.ts
else
  echo ">>> [API] Base déjà peuplée ($USERS utilisateurs) — seed ignoré."
fi

echo ">>> [API] Lancement du serveur…"
exec node dist/index.js
