#!/usr/bin/env bash
set -euo pipefail
cd /opt/sgm-cem && source .env
# Dépôt restic et clés DÉDIÉES aux sauvegardes (jamais celles de l'application) :
# /opt/sgm-cem/.backup.env (mode 600) définit RESTIC_REPOSITORY, AWS_ACCESS_KEY_ID,
# AWS_SECRET_ACCESS_KEY et BACKUP_HEARTBEAT_URL ; mot de passe restic dans .restic-pass.
source /opt/sgm-cem/.backup.env
export RESTIC_REPOSITORY AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY RESTIC_PASSWORD_FILE=/opt/sgm-cem/.restic-pass
TMP=$(mktemp -d)
restic restore latest --tag db --target "$TMP"
DUMP=$(find "$TMP" -name 'sgm_cem_*.dump' | head -1)
docker run -d --rm --name sgm-restore-test -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" postgres:17-bookworm
until docker exec sgm-restore-test pg_isready -U postgres >/dev/null 2>&1; do sleep 2; done
docker exec sgm-restore-test createdb -U postgres restore
docker exec -i sgm-restore-test pg_restore -U postgres -d restore --no-owner < "$DUMP"
docker exec sgm-restore-test psql -U postgres -d restore -At -c \
 "select 'users', count(*)::text from users union all select 'contributions', count(*)::text from contributions union all select 'max_contribution', coalesce(max(\"createdAt\")::text,'-') from contributions;"
# Reçus de dépôt archivés : chaque dépôt avec reçu en base doit avoir son fichier sauvegardé
restic dump latest --tag files uploads.tar | tar -tf - > "$TMP/fichiers.txt"
EXPECTED=$(docker exec sgm-restore-test psql -U postgres -d restore -At -c "select count(*) from bank_deposits where \"proofKey\" is not null")
FOUND=$(grep -c '^uploads/banque/.\+' "$TMP/fichiers.txt" || true)
echo "reçus de dépôt : ${FOUND} fichier(s) sauvegardé(s) pour ${EXPECTED} dépôt(s) avec reçu"
[ "$FOUND" -ge "$EXPECTED" ] || { echo "❌ reçus de dépôt manquants dans la sauvegarde"; docker stop sgm-restore-test; exit 1; }
docker stop sgm-restore-test; rm -rf "$TMP"
