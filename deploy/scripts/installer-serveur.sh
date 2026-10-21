#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SGM-CEM — installation d'un serveur neuf (Ubuntu 24.04 LTS), en root, UNE fois.
#
#   bash installer-serveur.sh --domaine app.exemple.cm --email admin@exemple.cm
#   Source des images (une au choix) :
#     (défaut)               construites sur le serveur depuis le dépôt GitHub
#     --registre <adresse>   images publiées par la CI, ex. ghcr.io/devnet8057 (le plus rapide)
#     --archive <fichier>    archive hors ligne sgm-cem-<version>.tar (serveur sans accès GitHub)
#   Autres options : --depot <url git>  (défaut : https://github.com/DevNet8057/sgm-cem.git)
#                    --ref <branche>    (défaut : main)
#                    --sans-systeme     (ne touche pas au système : dossiers, .env, déploiement)
#
# Ce que fait le script (chaque étape est sautée si elle est déjà faite) :
#   1. mises à jour, Docker, pare-feu (22, 80, 443), fail2ban, mises à jour de sécurité automatiques
#   2. mémoire d'échange de 2 Go (construction des images)
#   3. utilisateur « sgm » (membre de docker) qui reçoit les clés SSH de root ;
#      connexion par mot de passe et connexion root désactivées SEULEMENT si une clé est en place
#   4. accès au code : dépôt public en HTTPS, ou clé de déploiement en lecture seule (dépôt privé)
#   5. code dans /opt/sgm-cem/src (ou archive), .env de production aux secrets aléatoires (jamais écrasé)
#   6. premier déploiement (deployer.sh), puis affichage du mot de passe administrateur initial
# ─────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail

DOMAIN=""; EMAIL=""; REPO="https://github.com/DevNet8057/sgm-cem.git"; REF="main"; SYSTEM=1
ARCHIVE=""; REGISTRY=""
APP_USER="${SGM_USER:-sgm}"
BASE_DIR="${SGM_BASE_DIR:-/opt/sgm-cem}"

say()  { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die()  { printf '\n\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --domaine) DOMAIN="${2:?}"; shift 2 ;;
    --email) EMAIL="${2:?}"; shift 2 ;;
    --depot) REPO="${2:?}"; shift 2 ;;
    --ref) REF="${2:?}"; shift 2 ;;
    --sans-systeme) SYSTEM=0; shift ;;
    --archive) ARCHIVE="$(realpath "${2:?}")"; shift 2 ;;
    --registre) REGISTRY="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) die "Option inconnue : $1" ;;
  esac
done
[ -n "$DOMAIN" ] && [ -n "$EMAIL" ] || die "Usage : bash installer-serveur.sh --domaine app.exemple.cm --email admin@exemple.cm"
[ "$(id -u)" = 0 ] || die "À lancer en root (ou avec sudo)."
[ -z "$ARCHIVE" ] || [ -f "$ARCHIVE" ] || die "Archive introuvable : $ARCHIVE"
[ -z "$ARCHIVE" ] || [ -z "$REGISTRY" ] || die "Choisir --archive OU --registre, pas les deux."

# Commandes de l'utilisateur applicatif, depuis un dossier qu'il peut lire
as_user() { (cd / && sudo -u "$APP_USER" -H "$@"); }

# ── 1. Système ──────────────────────────────────────────────────────────────
if [ "$SYSTEM" = 1 ]; then
  . /etc/os-release
  [ "${ID:-}" = ubuntu ] || die "Prévu pour Ubuntu 24.04 LTS (système détecté : ${PRETTY_NAME:-inconnu})."

  say "1/6 Mises à jour et logiciels (Docker, pare-feu, fail2ban)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get upgrade -yq
  apt-get install -yq ca-certificates curl git ufw fail2ban unattended-upgrades
  if ! command -v docker > /dev/null; then
    apt-get install -yq docker.io docker-compose-v2
  fi
  systemctl enable --now docker
  docker compose version > /dev/null || die "docker compose (v2) indisponible"
  # Journaux Docker bornés pour ne pas remplir le disque
  if [ ! -f /etc/docker/daemon.json ]; then
    printf '{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }\n' > /etc/docker/daemon.json
    systemctl restart docker
  fi
  printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades
  systemctl enable --now fail2ban

  ufw allow OpenSSH > /dev/null
  ufw allow 80/tcp > /dev/null
  ufw allow 443/tcp > /dev/null
  ufw allow 443/udp > /dev/null
  ufw --force enable > /dev/null
  note "Pare-feu : seuls SSH, 80 et 443 sont ouverts."

  say "2/6 Mémoire d'échange"
  if ! swapon --show | grep -q .; then
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile > /dev/null && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    note "2 Go ajoutés."
  else
    note "Déjà présente."
  fi

  say "3/6 Utilisateur $APP_USER et accès SSH"
  id "$APP_USER" > /dev/null 2>&1 || useradd -m -s /bin/bash "$APP_USER"
  usermod -aG docker "$APP_USER"
  if [ -s /root/.ssh/authorized_keys ]; then
    install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
    install -m 600 -o "$APP_USER" -g "$APP_USER" /root/.ssh/authorized_keys "/home/$APP_USER/.ssh/authorized_keys"
    cat > /etc/ssh/sshd_config.d/10-sgm-cem.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
    if sshd -t 2>/dev/null; then
      systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
      note "Connexion par clé uniquement ; désormais : ssh $APP_USER@<adresse du serveur>"
    else
      rm -f /etc/ssh/sshd_config.d/10-sgm-cem.conf
      note "Configuration SSH non appliquée (vérification sshd en échec)."
    fi
  else
    note "ATTENTION : aucune clé SSH pour root. Le mot de passe SSH reste actif ;"
    note "ajoutez votre clé puis relancez ce script pour sécuriser l'accès."
  fi
else
  say "Étapes système sautées (--sans-systeme)"
  id "$APP_USER" > /dev/null 2>&1 || die "Utilisateur $APP_USER absent."
fi

# ── 4. Accès au dépôt ───────────────────────────────────────────────────────
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$BASE_DIR"
if [ -n "$ARCHIVE" ]; then
  say "4/6 Archive $(basename "$ARCHIVE") (aucun accès GitHub nécessaire)"
else
case "$REPO" in
  git@*|ssh://*)
    say "4/6 Clé de déploiement GitHub (lecture seule)"
    KEY="/home/$APP_USER/.ssh/sgm_cem_deploy"
    install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
    [ -f "$KEY" ] || as_user ssh-keygen -q -t ed25519 -N '' -C "deploiement-sgm-cem@$(hostname)" -f "$KEY"
    as_user sh -c "ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null; sort -u -o ~/.ssh/known_hosts ~/.ssh/known_hosts"
    export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes"
    until as_user env GIT_SSH_COMMAND="$GIT_SSH_COMMAND" git ls-remote "$REPO" > /dev/null 2>&1; do
      echo
      note "Ajoutez cette clé dans GitHub : dépôt → Settings → Deploy keys → Add deploy key"
      note "(titre : serveur SGM-CEM ; NE PAS cocher « Allow write access ») :"
      echo; cat "$KEY.pub"; echo
      read -r -p "  Appuyez sur Entrée une fois la clé ajoutée… " _
    done
    note "Accès au dépôt vérifié."
    ;;
  *) say "4/6 Dépôt : $REPO" ;;
esac
fi

# ── 5. Code et configuration ────────────────────────────────────────────────
say "5/6 Code et fichier .env"
if [ -n "$ARCHIVE" ]; then
  # Archive extraite pour l'utilisateur applicatif (supprimée après le déploiement)
  RELEASE_DIR="$BASE_DIR/releases"
  install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$RELEASE_DIR"
  TOP=$(tar -tf "$ARCHIVE" | awk -F/ 'NR==1{print $1}')     # awk lit tout : pas de SIGPIPE
  tar -xf "$ARCHIVE" -C "$RELEASE_DIR"            # en root : l'archive peut être dans /root
  BUNDLE="$RELEASE_DIR/$TOP"
  chown -R "$APP_USER:$APP_USER" "$BUNDLE"
  [ -f "$BUNDLE/manifest.env" ] || die "Archive invalide : manifest.env introuvable"
  note "Archive extraite : $BUNDLE"
else
  if [ ! -d "$BASE_DIR/src/.git" ]; then
    as_user env GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh}" git clone -q "$REPO" "$BASE_DIR/src"
  fi
  [ -n "${GIT_SSH_COMMAND:-}" ] && as_user git -C "$BASE_DIR/src" config core.sshCommand "$GIT_SSH_COMMAND"
  as_user git -C "$BASE_DIR/src" fetch -q origin
  as_user git -C "$BASE_DIR/src" rev-parse -q --verify "origin/$REF" > /dev/null || die "Branche « $REF » introuvable dans le dépôt."
fi

ENV_FILE="$BASE_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  note ".env existant conservé (jamais écrasé)."
else
  rnd() { openssl rand -hex "$1"; }
  b64() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-56; }
  PGPASS=$(rnd 24); REDISPASS=$(rnd 24)
  cat > "$ENV_FILE" <<EOF
# Production SGM-CEM — généré le $(date '+%d/%m/%Y') par installer-serveur.sh. Mode 600, jamais versionné.
# Garder une copie de ce fichier dans un coffre (gestionnaire de mots de passe) : sans lui,
# les secrets d'intégration enregistrés en base ne sont plus lisibles.
APP_DOMAIN=$DOMAIN
ACME_EMAIL=$EMAIL
APP_URL=https://$DOMAIN
API_URL=https://$DOMAIN
DEPLOY_REF=$REF
TZ=Africa/Douala

# Images : renseignées par deployer.sh à chaque version
IMAGE_API=
IMAGE_WEB=
APP_VERSION=
# Registre des images publiées par la CI (vide = construction sur le serveur).
# Registre privé : REGISTRY_USER et REGISTRY_TOKEN (jeton en lecture seule).
IMAGE_REGISTRY=$REGISTRY
REGISTRY_USER=
REGISTRY_TOKEN=

POSTGRES_USER=sgm_app
POSTGRES_PASSWORD=$PGPASS
POSTGRES_DB=sgm_cem
DATABASE_URL=postgresql://sgm_app:$PGPASS@postgres:5432/sgm_cem?schema=public&connection_limit=10
REDIS_PASSWORD=$REDISPASS
REDIS_URL=redis://:$REDISPASS@redis:6379

JWT_SECRET=$(b64)
REFRESH_TOKEN_SECRET=$(b64)
CSRF_SECRET=$(b64)
CONFIG_ENCRYPTION_KEY=$(b64)
TRUST_PROXY=1

# Premier démarrage : mot de passe administrateur aléatoire affiché UNE fois dans
# « docker compose logs api » ; changement imposé à la première connexion.
ADMIN_EMAIL=$EMAIL
ADMIN_PASSWORD=
SEED_DEMO=0

LOG_LEVEL=info
SENTRY_DSN=
# Intégrations (Yelii, CinetPay, WhatsApp, SMTP, stockage S3…) : à saisir dans le
# panneau Développeur de l'application (chiffrées en base). Liste : deploy/.env.example
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  note "Secrets générés dans $ENV_FILE (mode 600)."
fi

# ── 6. Premier déploiement ──────────────────────────────────────────────────
DEPLOY_ENV=(env SGM_BASE_DIR="$BASE_DIR" DOCKERFILE_API="${DOCKERFILE_API:-}" DOCKERFILE_WEB="${DOCKERFILE_WEB:-}" BUILD_EXTRA_ARGS="${BUILD_EXTRA_ARGS:-}")
if [ -n "$ARCHIVE" ]; then
  say "6/6 Premier déploiement (chargement des images de l'archive : 2 à 5 min)"
  as_user "${DEPLOY_ENV[@]}" bash "$BUNDLE/deploy/scripts/deployer.sh" --archive "$BUNDLE"
  rm -rf "$BUNDLE"
elif [ -n "$REGISTRY" ]; then
  say "6/6 Premier déploiement (téléchargement des images depuis $REGISTRY)"
  as_user "${DEPLOY_ENV[@]}" bash "$BASE_DIR/src/deploy/scripts/deployer.sh" --ref "$REF"
else
  say "6/6 Premier déploiement (construction des images : 5 à 15 min)"
  as_user "${DEPLOY_ENV[@]}" bash "$BASE_DIR/src/deploy/scripts/deployer.sh" --ref "$REF"
fi

say "Installation terminée"
note "Site : https://$DOMAIN"
# Le mot de passe initial n'existe que dans le journal du PREMIER conteneur de l'API :
# il est affiché ici, car un redéploiement ultérieur le ferait disparaître.
ADMIN_LINE=$(cd "$BASE_DIR" && docker compose --env-file .env -f docker-compose.prod.yml logs api 2>/dev/null | grep -i 'mot de passe temporaire' | tail -n1 | sed 's/.*: //')
if [ -n "$ADMIN_LINE" ]; then
  note "Compte administrateur : $EMAIL"
  note "Mot de passe initial  : $ADMIN_LINE   ← à noter MAINTENANT (changement imposé à la 1re connexion)"
else
  note "Compte administrateur : $EMAIL (mot de passe défini précédemment, inchangé)"
fi
if [ -n "$ARCHIVE" ]; then
  note "Mises à jour suivantes : copier la nouvelle archive puis  $BASE_DIR/scripts/deployer.sh --archive <fichier.tar>"
else
  note "Mises à jour suivantes : ssh $APP_USER@<serveur> \"$BASE_DIR/scripts/deployer.sh\""
fi
note "Sauvegardes hors serveur : voir docs/exploitation/03_GUIDE_DEPLOIEMENT_PRODUCTION.md, § 8, puis activer scripts/backup.sh dans cron."
