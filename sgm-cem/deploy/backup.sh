#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ $EUID -ne 0 ]]; then
  echo 'Exécuter cette sauvegarde avec sudo.' >&2
  exit 1
fi

APP_DIR=/srv/sgm-cem/sgm-cem
BACKUP_ROOT=/var/backups/sgm-cem
install -d -m 700 "$BACKUP_ROOT"
exec 9>"$BACKUP_ROOT/.backup.lock"
flock -n 9 || { echo 'Une sauvegarde est déjà en cours.'; exit 0; }

cd "$APP_DIR"
compose=(/usr/bin/docker compose -p sgm-cem -f docker-compose.prod.yml)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
pending=$(mktemp -d "$BACKUP_ROOT/.partial-$stamp.XXXXXX")
trap 'echo "Sauvegarde interrompue ; fichiers partiels conservés dans $pending." >&2' ERR

"${compose[@]}" exec -T postgres pg_dump -U postgres -d sgm_cem -Fc --no-owner --no-acl > "$pending/postgres.dump"
"${compose[@]}" exec -T postgres pg_restore --list < "$pending/postgres.dump" > /dev/null
"${compose[@]}" exec -T api tar -C /app/apps/api -czf - uploads > "$pending/uploads.tar.gz"
tar -tzf "$pending/uploads.tar.gz" > /dev/null

install -m 600 .env "$pending/production.env"
install -m 600 .deployment-credentials.env.local "$pending/initial-credentials.env.local"
if [[ -f .database-access.env.local ]]; then
  install -m 600 .database-access.env.local "$pending/database-access.env.local"
fi
install -m 600 docker-compose.prod.yml "$pending/docker-compose.prod.yml"
install -m 600 deploy/nginx.conf "$pending/nginx.conf"
tar -czf "$pending/deployment-files.tar.gz" deploy
GIT_OPTIONAL_LOCKS=0 git -c safe.directory=/srv/sgm-cem -C /srv/sgm-cem rev-parse HEAD > "$pending/source-commit.txt"
GIT_OPTIONAL_LOCKS=0 git -c safe.directory=/srv/sgm-cem -C /srv/sgm-cem diff --binary > "$pending/deployment-changes.patch"
GIT_OPTIONAL_LOCKS=0 git -c safe.directory=/srv/sgm-cem -C /srv/sgm-cem ls-files --others --exclude-standard -z -- sgm-cem/apps sgm-cem/packages > "$pending/untracked-app-files.list"
tar -C /srv/sgm-cem --null -T "$pending/untracked-app-files.list" -czf "$pending/untracked-app-files.tar.gz"
"${compose[@]}" images --format json > "$pending/images.json"
(cd "$pending" && {
  sha256sum postgres.dump uploads.tar.gz production.env deployment-files.tar.gz deployment-changes.patch untracked-app-files.tar.gz
  if [[ -f database-access.env.local ]]; then sha256sum database-access.env.local; fi
} > SHA256SUMS)

test ! -e "$BACKUP_ROOT/$stamp"
mv "$pending" "$BACKUP_ROOT/$stamp"
# Seuls les anciens répertoires finalisés de ce job sont concernés.
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????Z' -mtime +14 -exec rm -rf -- {} +
echo "Sauvegarde validée : $BACKUP_ROOT/$stamp"
