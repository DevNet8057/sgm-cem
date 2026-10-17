#!/usr/bin/env bash
set -euo pipefail
cd /opt/sgm-cem
source .env
# Dépôt restic et clés DÉDIÉES aux sauvegardes (jamais celles de l'application) :
# /opt/sgm-cem/.backup.env (mode 600) définit RESTIC_REPOSITORY, AWS_ACCESS_KEY_ID,
# AWS_SECRET_ACCESS_KEY et BACKUP_HEARTBEAT_URL ; mot de passe restic dans .restic-pass.
source /opt/sgm-cem/.backup.env
export RESTIC_REPOSITORY AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY RESTIC_PASSWORD_FILE=/opt/sgm-cem/.restic-pass
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="backups/sgm_cem_${STAMP}.dump"
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges > "$OUT"
test -s "$OUT"                                     # dump non vide
docker compose -f docker-compose.prod.yml exec -T postgres pg_restore --list < "$OUT" > /dev/null   # dump lisible
sha256sum "$OUT" > "$OUT.sha256"
restic backup "$OUT" "$OUT.sha256" --tag db --host sgm-cem-prod
restic forget --tag db --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --keep-yearly 10 --prune
find backups -name 'sgm_cem_*.dump*' -mtime +3 -delete      # 3 jours en local seulement
curl -fsS -m 10 "$BACKUP_HEARTBEAT_URL" > /dev/null    # signal « sauvegarde OK » (sonde de type dead man's switch)
