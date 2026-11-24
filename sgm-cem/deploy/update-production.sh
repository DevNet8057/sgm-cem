#!/usr/bin/env bash
# Mise à jour de l’installation Nginx/Compose existante, sans changement de volumes.
set -Eeuo pipefail
umask 077
APP_DIR=/srv/sgm-cem/sgm-cem
REPO_DIR=/srv/sgm-cem
ORIGIN=https://sgm-cem.16-16-63-155.sslip.io
[[ $EUID -eq 0 ]] || { echo 'Lancer avec sudo.' >&2; exit 1; }
cd "$APP_DIR"
exec 9>/run/lock/sgm-cem-update.lock
flock -n 9 || { echo 'Une mise à jour est déjà en cours.' >&2; exit 1; }
dc() { docker compose -p sgm-cem -f docker-compose.prod.yml "$@"; }
g() { git -c safe.directory="$REPO_DIR" -C "$REPO_DIR" "$@"; }
if [[ ${1:-} == --etat ]]; then
  dc ps
  g log -1 --format='%h %s'
  [[ ! -f .deployment-state.json ]] || cat .deployment-state.json
  exit 0
fi
[[ $# -eq 0 || ( $# -eq 1 && $1 == --sans-build ) ]] || { echo 'Usage : update-production.sh [--etat|--sans-build]' >&2; exit 1; }
g diff --quiet && g diff --cached --quiet || { echo 'Sources modifiées : sauvegarder et enregistrer les correctifs avant mise à jour.' >&2; exit 1; }
[[ -z $(g ls-files --others --exclude-standard -- sgm-cem/apps sgm-cem/packages sgm-cem/deploy) ]] || { echo 'Sources non enregistrées : contrôler les fichiers avant mise à jour.' >&2; exit 1; }
dc config --quiet
api_id=$(dc ps -q api); web_id=$(dc ps -q web)
[[ -n $api_id && -n $web_id ]] || { echo 'Cette commande met à jour une installation déjà démarrée.' >&2; exit 1; }
old_api=$(docker inspect --format '{{.Image}}' "$api_id")
old_web=$(docker inspect --format '{{.Image}}' "$web_id")
# Windows et Linux peuvent conserver des fins de ligne différentes dans l'image.
# Seules les fins CRLF sont normalisées ; tout autre changement reste bloquant.
running_schema=$(docker exec "$api_id" cat /app/apps/api/prisma/schema.prisma | sed 's/\r$//' | sha256sum | cut -d' ' -f1)
source_schema=$(sed 's/\r$//' apps/api/prisma/schema.prisma | sha256sum | cut -d' ' -f1)
[[ $running_schema == "$source_schema" ]] || { echo 'Changement de schéma détecté : préparer une opération de migration distincte avant cette mise à jour.' >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker tag "$old_api" "sgm-cem-api:rollback-$stamp"
docker tag "$old_web" "sgm-cem-web:rollback-$stamp"
systemctl start sgm-cem-backup.service
[[ $(systemctl show -p Result --value sgm-cem-backup.service) == success ]] || { echo 'Sauvegarde non validée : mise à jour arrêtée.' >&2; exit 1; }
switched=0
rollback() {
  local original_status=${1:-$?}
  trap - ERR INT TERM HUP
  echo 'Échec de mise à jour : rétablissement des images précédentes.' >&2
  docker tag "$old_api" sgm-cem-api:production
  docker tag "$old_web" sgm-cem-web:production
  if [[ $switched -eq 1 ]]; then
    dc up -d --no-build --no-deps --force-recreate --wait --wait-timeout 300 api web || true
  fi
  exit "$original_status"
}
trap rollback ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM
trap 'rollback 129' HUP
if [[ ${1:-} != --sans-build ]]; then
  dc build api
  dc build web
fi
switched=1
dc up -d --no-build --no-deps --wait --wait-timeout 300 api web
curl --fail --silent --show-error "$ORIGIN/api/health" >/dev/null
commit=$(g rev-parse HEAD)
new_api=$(docker inspect --format '{{.Image}}' "$(dc ps -q api)")
new_web=$(docker inspect --format '{{.Image}}' "$(dc ps -q web)")
state=$(mktemp .deployment-state.XXXXXX)
printf '{"commit":"%s","deployedAt":"%s","apiImage":"%s","webImage":"%s","rollbackApi":"%s","rollbackWeb":"%s"}\n' "$commit" "$stamp" "$new_api" "$new_web" "$old_api" "$old_web" >"$state"
mv "$state" .deployment-state.json
trap - ERR INT TERM HUP
echo "Mise à jour vérifiée : $commit"
dc ps
