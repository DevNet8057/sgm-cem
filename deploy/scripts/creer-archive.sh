#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SGM-CEM — archive de déploiement HORS LIGNE (toutes les images + l'exploitation)
#
#   creer-archive.sh --api IMG --web IMG [--proxy IMG] --sha SHA12 [--version V] [--sortie DOSSIER]
#
# Produit DOSSIER/sgm-cem-<version>.tar contenant :
#   images/*.tar.gz    les 7 images (api, web, passerelle, Caddy, PostgreSQL, Redis, Gotenberg)
#   deploy/            docker-compose.prod.yml, Caddyfile, scripts, passerelle, .env.example
#   manifest.env       version, commit et noms des images
#   SHA256SUMS         sommes de contrôle (vérifiées à l'installation)
# Installation : installer-serveur.sh --archive sgm-cem-<version>.tar  (serveur sans accès GitHub)
# Mise à jour  : deployer.sh --archive sgm-cem-<version>.tar
#
# Utilisé par la CI (.github/workflows/images.yml) et utilisable à la main sur toute
# machine qui dispose de Docker et des images (construites ou téléchargées).
# ─────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail

API=""; WEB=""; PROXY=""; SHA=""; VERSION=""; OUT="."
while [ $# -gt 0 ]; do
  case "$1" in
    --api) API="$2"; shift 2 ;;
    --web) WEB="$2"; shift 2 ;;
    --proxy) PROXY="$2"; shift 2 ;;
    --sha) SHA="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --sortie) OUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 1 ;;
  esac
done
[ -n "$API" ] && [ -n "$WEB" ] && [ -n "$SHA" ] || { echo "Usage : creer-archive.sh --api IMG --web IMG --sha SHA12 [--proxy IMG] [--version V] [--sortie DOSSIER]" >&2; exit 1; }
VERSION="${VERSION:-$(date +%Y%m%d)-$SHA}"
ROOT=$(cd "$(dirname "$0")/../.." && pwd)          # racine du dépôt
COMPOSE="$ROOT/deploy/docker-compose.prod.yml"

NAME="sgm-cem-$VERSION"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
B="$WORK/$NAME"; mkdir -p "$B/images" "$B/deploy"

say() { printf '▶ %s\n' "$*"; }

# Images tierces : référence épinglée lue dans le compose (${IMAGE_X:-ref@sha256:…}),
# rangée sous un nom local stable (sgm-cem-ext/…) que docker load restitue toujours.
declare -A EXT
for var in IMAGE_CADDY IMAGE_POSTGRES IMAGE_REDIS IMAGE_GOTENBERG; do
  ref=$(grep -oE "\\\$\{$var:-[^}]+\}" "$COMPOSE" | sed -E "s/^\\\$\{$var:-(.*)\}$/\1/")
  [ -n "$ref" ] || { echo "Référence de $var introuvable dans le compose" >&2; exit 1; }
  docker image inspect "$ref" > /dev/null 2>&1 || docker pull -q "$ref" > /dev/null
  repo_tag="${ref%@*}"                                # caddy:2.11-alpine
  local_name="sgm-cem-ext/${repo_tag##*/}"            # sgm-cem-ext/caddy:2.11-alpine
  docker tag "$ref" "$local_name"
  EXT[$var]="$local_name"
done

# Images de l'application sous des noms locaux simples
docker tag "$API" "sgm-cem-api:$SHA"
docker tag "$WEB" "sgm-cem-web:$SHA"
[ -n "$PROXY" ] && docker tag "$PROXY" "sgm-cem-proxy:$SHA"

save() {   # $1 = image, $2 = fichier
  say "Image $1"
  docker save "$1" | gzip -6 > "$B/images/$2.tar.gz"
}
save "sgm-cem-api:$SHA" api
save "sgm-cem-web:$SHA" web
[ -n "$PROXY" ] && save "sgm-cem-proxy:$SHA" proxy
save "${EXT[IMAGE_CADDY]}" caddy
save "${EXT[IMAGE_POSTGRES]}" postgres
save "${EXT[IMAGE_REDIS]}" redis
save "${EXT[IMAGE_GOTENBERG]}" gotenberg

say "Fichiers d'exploitation"
cp "$ROOT/deploy/docker-compose.prod.yml" "$ROOT/deploy/Caddyfile" "$ROOT/deploy/.env.example" "$ROOT/deploy/README.md" "$B/deploy/"
cp -r "$ROOT/deploy/scripts" "$ROOT/deploy/pc" "$ROOT/deploy/proxy" "$B/deploy/"
[ -f "$ROOT/deploy/render.yaml" ] && cp "$ROOT/deploy/render.yaml" "$B/deploy/"

cat > "$B/manifest.env" <<EOF
VERSION=$VERSION
GIT_SHA=$SHA
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
IMAGE_API=sgm-cem-api:$SHA
IMAGE_WEB=sgm-cem-web:$SHA
IMAGE_PROXY=${PROXY:+sgm-cem-proxy:$SHA}
IMAGE_CADDY=${EXT[IMAGE_CADDY]}
IMAGE_POSTGRES=${EXT[IMAGE_POSTGRES]}
IMAGE_REDIS=${EXT[IMAGE_REDIS]}
IMAGE_GOTENBERG=${EXT[IMAGE_GOTENBERG]}
EOF
cp "$ROOT/deploy/scripts/installer-serveur.sh" "$B/installer-serveur.sh"
( cd "$B" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS )

mkdir -p "$OUT"
tar -cf "$OUT/$NAME.tar" -C "$WORK" "$NAME"      # images déjà compressées : pas de 2e compression
( cd "$OUT" && sha256sum "$NAME.tar" > "$NAME.tar.sha256" )
say "Archive : $OUT/$NAME.tar ($(du -h "$OUT/$NAME.tar" | cut -f1))"
