#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SGM-CEM — déploiement par script (sur le serveur, utilisateur « sgm »)
#
#   deployer.sh                  déploie la branche réglée (DEPLOY_REF du .env, sinon main)
#   deployer.sh --ref v1.2.0     déploie une branche, une étiquette ou un commit précis
#   deployer.sh --retour         revient à la version précédente (images conservées)
#   deployer.sh --etat           affiche la version en service et la précédente
#
# Étapes : récupération du code → construction des images À CÔTÉ de la version en
# service (le site reste en ligne) → sauvegarde de la base → bascule (l'API applique
# les migrations au démarrage, après sa propre sauvegarde) → contrôle de santé →
# retour automatique à la version précédente en cas d'échec → nettoyage.
# Interruption du service : le temps du redémarrage des conteneurs (quelques secondes).
#
# Les migrations sont additives (règle du projet) : l'ancienne version fonctionne
# avec le nouveau schéma, le retour arrière ne touche donc pas à la base.
# ─────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail

BASE_DIR="${SGM_BASE_DIR:-/opt/sgm-cem}"
SRC_DIR="$BASE_DIR/src"
ENV_FILE="$BASE_DIR/.env"
STATE_FILE="$BASE_DIR/.deploy-state"
COMPOSE_FILE="$BASE_DIR/docker-compose.prod.yml"
LOG_FILE="$BASE_DIR/deploy.log"
KEEP_IMAGES=3                 # versions gardées sur le disque pour un retour arrière
HEALTH_TIMEOUT=420            # secondes : sauvegarde + migrations + démarrage de l'API

# Réglages avancés (réseau particulier, proxy d'entreprise) — vides en temps normal
DOCKERFILE_API="${DOCKERFILE_API:-}"
DOCKERFILE_WEB="${DOCKERFILE_WEB:-}"
read -r -a BUILD_EXTRA <<< "${BUILD_EXTRA_ARGS:-}"

# ── Affichage et journal ────────────────────────────────────────────────────
STARTED=$(date +%s)
log()  { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }
ok()   { log "✔ $*"; }
warn() { log "⚠ $*"; }
die()  { log "✘ $*"; exit 1; }

# ── Lecture/écriture du .env sans l'exécuter (valeurs avec & ? $ …) ─────────
env_get() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
env_set() {
  local key="$1" value="$2" tmp
  tmp=$(mktemp "$BASE_DIR/.env.XXXXXX")
  grep -vE "^$key=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}
state_get() { [ -f "$STATE_FILE" ] && grep -E "^$1=" "$STATE_FILE" | cut -d= -f2- || true; }

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# ── Santé des conteneurs ────────────────────────────────────────────────────
health_of() {
  local id
  id=$(compose ps -q "$1" 2>/dev/null | head -n1)
  [ -n "$id" ] || { echo "absent"; return; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo "absent"
}

wait_healthy() {
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT )) s all
  while [ "$(date +%s)" -lt "$deadline" ]; do
    all=1
    for s in "$@"; do
      case "$(health_of "$s")" in
        healthy|running) ;;
        unhealthy|exited|dead) log "   $s : en échec"; return 1 ;;
        *) all=0 ;;
      esac
    done
    [ "$all" = 1 ] && return 0
    sleep 5
  done
  log "   délai de ${HEALTH_TIMEOUT}s dépassé"
  return 1
}

# Contrôle de bout en bout : HTTPS par Caddy jusqu'à l'API et la base
check_https() {
  local domain
  domain=$(env_get APP_DOMAIN)
  [ -n "$domain" ] || return 0
  local insecure=()
  # Domaine de test (localhost, *.local) : certificat de l'autorité interne de Caddy
  case "$domain" in localhost|*.localhost|*.local|*.test) insecure=(-k) ;; esac
  for _ in $(seq 1 24); do
    if curl -fsS "${insecure[@]}" -m 10 --resolve "$domain:443:127.0.0.1" "https://$domain/api/health/ready" > /dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done
  return 1
}

# ── Bascule vers un couple d'images (avec contrôle) ─────────────────────────
switch_to() {
  local api="$1" web="$2" version="$3"
  env_set IMAGE_API "$api"
  env_set IMAGE_WEB "$web"
  env_set APP_VERSION "$version"
  compose up -d --remove-orphans 2>&1 | tee -a "$LOG_FILE" > /dev/null
  wait_healthy postgres redis gotenberg api worker web caddy
}

show_state() {
  echo "En service  : $(state_get CURRENT_VERSION)  ($(env_get IMAGE_API), $(env_get IMAGE_WEB))"
  echo "Précédente  : $(state_get PREVIOUS_VERSION)  ($(state_get PREVIOUS_API), $(state_get PREVIOUS_WEB))"
  echo "Déployée le : $(state_get DEPLOYED_AT)"
  compose ps --format 'table {{.Service}}\t{{.Status}}'
}

write_state() {
  cat > "$STATE_FILE" <<EOF
CURRENT_VERSION=$1
CURRENT_API=$2
CURRENT_WEB=$3
PREVIOUS_VERSION=$4
PREVIOUS_API=$5
PREVIOUS_WEB=$6
DEPLOYED_AT=$(date '+%Y-%m-%d %H:%M:%S %Z')
EOF
}

rollback() {
  local api web version
  api=$(state_get PREVIOUS_API); web=$(state_get PREVIOUS_WEB); version=$(state_get PREVIOUS_VERSION)
  [ -n "$api" ] && [ -n "$web" ] || die "Aucune version précédente enregistrée : retour impossible."
  docker image inspect "$api" "$web" > /dev/null 2>&1 || die "Images de la version précédente absentes du serveur."
  log "Retour à la version $version…"
  if switch_to "$api" "$web" "$version"; then
    write_state "$version" "$api" "$web" "$(state_get CURRENT_VERSION)" "$(state_get CURRENT_API)" "$(state_get CURRENT_WEB)"
    ok "Version $version remise en service."
  else
    die "Le retour arrière a lui aussi échoué : voir « docker compose logs api » et docs/exploitation/03_GUIDE_DEPLOIEMENT_PRODUCTION.md, § 11 (restauration)."
  fi
}

# ── Arguments ───────────────────────────────────────────────────────────────
MODE=deploy
REF=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="${2:?--ref attend une branche, une étiquette ou un commit}"; shift 2 ;;
    --retour|--rollback) MODE=rollback; shift ;;
    --etat|--status) MODE=state; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "Option inconnue : $1 (voir --help)" ;;
  esac
done

cd "$BASE_DIR" 2>/dev/null || { echo "$BASE_DIR introuvable : lancer d'abord installer-serveur.sh" >&2; exit 1; }
[ -f "$ENV_FILE" ] || die "$ENV_FILE introuvable : lancer d'abord installer-serveur.sh"
[ -d "$SRC_DIR/.git" ] || die "$SRC_DIR n'est pas un dépôt git : lancer d'abord installer-serveur.sh"
command -v docker > /dev/null || die "Docker n'est pas installé"

# Un seul déploiement à la fois
exec 9> "$BASE_DIR/.deploy.lock"
flock -n 9 || die "Un déploiement est déjà en cours."

case "$MODE" in
  state) show_state; exit 0 ;;
  rollback) rollback; exit 0 ;;
esac

log "════ Déploiement SGM-CEM ════"

# 1. Code
REF="${REF:-$(env_get DEPLOY_REF)}"; REF="${REF:-main}"
log "1/7 Récupération du code ($REF)…"
git -C "$SRC_DIR" fetch --prune --tags origin 2>&1 | tee -a "$LOG_FILE" > /dev/null
if git -C "$SRC_DIR" rev-parse -q --verify "origin/$REF^{commit}" > /dev/null; then
  TARGET="origin/$REF"
else
  TARGET="$REF"
fi
git -C "$SRC_DIR" -c advice.detachedHead=false checkout -q --force --detach "$TARGET" || die "Référence introuvable : $REF"
SHA=$(git -C "$SRC_DIR" rev-parse --short=12 HEAD)
VERSION="$(date +%Y%m%d)-$SHA"
ok "Code au commit $SHA ($(git -C "$SRC_DIR" log -1 --format=%s | cut -c1-70))"

# 2. Fichiers d'exploitation (compose, Caddy, scripts) à la version du code
log "2/7 Fichiers d'exploitation…"
install -m 644 "$SRC_DIR/deploy/docker-compose.prod.yml" "$COMPOSE_FILE"
install -m 644 "$SRC_DIR/deploy/Caddyfile" "$BASE_DIR/Caddyfile"
mkdir -p "$BASE_DIR/scripts" "$BASE_DIR/backups"
install -m 755 "$SRC_DIR"/deploy/scripts/*.sh "$BASE_DIR/scripts/"
API_IMAGE="sgm-cem-api:$SHA"
WEB_IMAGE="sgm-cem-web:$SHA"
IMAGE_API="$API_IMAGE" IMAGE_WEB="$WEB_IMAGE" compose config -q || die "docker-compose.prod.yml invalide avec ce .env"
ok "Configuration validée"

# 3. Images (le site actuel reste en service pendant la construction)
APP_URL=$(env_get APP_URL)
[ -n "$APP_URL" ] || die "APP_URL absent du .env"
build() {
  local name="$1" dockerfile="$2"; shift 2
  local df=(-f "$SRC_DIR/sgm-cem/apps/$name/Dockerfile")
  [ -n "$dockerfile" ] && df=(-f "$dockerfile")
  docker build "${df[@]}" "${BUILD_EXTRA[@]}" \
    --build-arg GIT_SHA="$SHA" --build-arg VERSION="$VERSION" "$@" \
    -t "sgm-cem-$name:$SHA" "$SRC_DIR/sgm-cem" >> "$LOG_FILE" 2>&1
}
if docker image inspect "$API_IMAGE" "$WEB_IMAGE" > /dev/null 2>&1; then
  log "3/7 Images $SHA déjà construites : réutilisées"
else
  log "3/7 Construction des images (le site reste en ligne ; 3 à 10 min)…"
  build api "$DOCKERFILE_API" || die "Construction de l'API en échec (détail : $LOG_FILE). Rien n'a été modifié."
  ok "Image API construite"
  # NEXT_PUBLIC_* figées au build : le site appelle l'API sur le même domaine (Caddy)
  build web "$DOCKERFILE_WEB" \
    --build-arg NEXT_PUBLIC_API_URL="$APP_URL" \
    --build-arg NEXT_PUBLIC_APP_URL="$APP_URL" \
    --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID="$(env_get GOOGLE_CLIENT_ID)" \
    || die "Construction du site en échec (détail : $LOG_FILE). Rien n'a été modifié."
  ok "Image web construite"
fi

# 4. Sauvegarde de la base avant bascule (en plus de celle de l'API au démarrage)
log "4/7 Sauvegarde de la base…"
if [ "$(health_of postgres)" = "healthy" ]; then
  DUMP="$BASE_DIR/backups/pre-deploy_$(date -u +%Y%m%dT%H%M%SZ)_$SHA.dump"
  compose exec -T postgres pg_dump -U "$(env_get POSTGRES_USER)" -d "$(env_get POSTGRES_DB)" -Fc --no-owner --no-privileges > "$DUMP"
  [ -s "$DUMP" ] && compose exec -T postgres pg_restore --list < "$DUMP" > /dev/null || die "Sauvegarde illisible : déploiement arrêté, rien n'a été modifié."
  chmod 600 "$DUMP"
  ls -1t "$BASE_DIR"/backups/pre-deploy_*.dump 2>/dev/null | tail -n +11 | xargs -r rm -f
  ok "Base sauvegardée : $(basename "$DUMP") ($(du -h "$DUMP" | cut -f1))"
else
  log "   Premier démarrage : pas encore de base à sauvegarder"
fi

# 5. Bascule
# Version précédente = dernier déploiement RÉUSSI (jamais une tentative échouée) ;
# un redéploiement de la même version conserve la précédente déjà enregistrée
PREV_API=$(state_get CURRENT_API); PREV_WEB=$(state_get CURRENT_WEB); PREV_VERSION=$(state_get CURRENT_VERSION)
if [ "$PREV_API" = "$API_IMAGE" ]; then
  PREV_API=$(state_get PREVIOUS_API); PREV_WEB=$(state_get PREVIOUS_WEB); PREV_VERSION=$(state_get PREVIOUS_VERSION)
fi
log "5/7 Mise en service de $VERSION…"
if ! switch_to "$API_IMAGE" "$WEB_IMAGE" "$VERSION"; then
  warn "La nouvelle version ne démarre pas. Dernières lignes de l'API :"
  compose logs --no-color --tail 40 api 2>&1 | tee -a "$LOG_FILE"
  if [ -n "$PREV_API" ] && [ "$PREV_API" != "$API_IMAGE" ]; then
    log "Retour à la version $PREV_VERSION…"
    if switch_to "$PREV_API" "$PREV_WEB" "$PREV_VERSION"; then
      die "Déploiement annulé : la version $PREV_VERSION est restée en service."
    fi
    die "Le retour arrière a lui aussi échoué : voir « docker compose logs api » et docs/exploitation/03_GUIDE_DEPLOIEMENT_PRODUCTION.md, § 11 (restauration)."
  fi
  die "Échec du premier déploiement : voir les journaux ci-dessus."
fi
write_state "$VERSION" "$API_IMAGE" "$WEB_IMAGE" "$PREV_VERSION" "$PREV_API" "$PREV_WEB"
ok "Conteneurs en bonne santé"

# 6. Contrôle de bout en bout (HTTPS → Caddy → API → base)
log "6/7 Contrôle HTTPS…"
if check_https; then
  ok "https://$(env_get APP_DOMAIN) répond"
else
  warn "HTTPS ne répond pas encore : vérifier le DNS du domaine et les ports 80/443 (certificat Let's Encrypt)."
fi

# 7. Nettoyage : on garde les $KEEP_IMAGES dernières versions pour un retour arrière
log "7/7 Nettoyage…"
for repo in sgm-cem-api sgm-cem-web; do
  docker images "$repo" --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' | sort -r | tail -n +$((KEEP_IMAGES + 1)) | cut -f2 \
    | while read -r img; do
        [ "$img" = "$(env_get IMAGE_API)" ] || [ "$img" = "$(env_get IMAGE_WEB)" ] || [ "$img" = "$PREV_API" ] || [ "$img" = "$PREV_WEB" ] || docker rmi "$img" > /dev/null 2>&1 || true
      done
done
docker image prune -f > /dev/null 2>&1 || true
# Cache de construction plafonné à 4 Go (sans plafond il dépasse 10 Go en quelques versions).
# --max-used-space : Docker ≥ 28 ; --keep-storage : versions antérieures
docker builder prune -f --max-used-space 4gb > /dev/null 2>&1 \
  || docker builder prune -f --keep-storage 4gb > /dev/null 2>&1 || true

ok "Version $VERSION en service en $(( $(date +%s) - STARTED ))s. Retour arrière possible : deployer.sh --retour"
