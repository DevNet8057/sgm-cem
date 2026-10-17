#!/usr/bin/env bash
# Sauvegarde de la base PostgreSQL du conteneur Docker SGM-CEM (Linux/macOS).
# À lancer AVANT toute mise à jour : ./scripts/backup-db.sh
# Produit backups/sgm_cem_<date>.dump (pg_dump -Fc) et vérifie sa lisibilité. Ne modifie jamais la base.
set -euo pipefail
CONTAINER="${CONTAINER:-sgm-cem-postgres-1}"
DATABASE="${DATABASE:-sgm_cem}"
DB_USER="${DB_USER:-postgres}"
OUT_DIR="${OUT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/backups}"

[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = "true" ] \
  || { echo "Le conteneur $CONTAINER n'est pas démarré (docker compose up -d postgres)." >&2; exit 1; }

mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/sgm_cem_$(date -u +%Y%m%dT%H%M%SZ).dump"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DATABASE" -Fc --no-owner > "$FILE"
test -s "$FILE" || { echo "Sauvegarde vide : $FILE" >&2; exit 1; }
docker exec -i "$CONTAINER" pg_restore --list < "$FILE" > /dev/null
COUNTS=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DATABASE" -At -c \
  "select 'utilisateurs=' || (select count(*) from users) || ' contributions=' || (select count(*) from contributions)")
echo "Sauvegarde OK : $FILE ($(du -h "$FILE" | cut -f1)) — $COUNTS"
echo "Restauration : docker exec -i $CONTAINER pg_restore -U $DB_USER -d $DATABASE --clean --if-exists --no-owner < <fichier>"
