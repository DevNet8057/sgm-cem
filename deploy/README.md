# `deploy/` — mise en production par script

Recommandation et justification complètes : `docs/exploitation/09_DEPLOIEMENT_RECOMMANDE.pdf`.
Référence détaillée (sécurité, check-list GO/NO-GO, incidents) : `docs/exploitation/03_GUIDE_DEPLOIEMENT_PRODUCTION.md`.

## En bref

Un serveur Ubuntu 24.04 (x86, 2 vCPU / 4 Go minimum), Docker Compose, Caddy pour le HTTPS.
Chaque déploiement sauvegarde la base, bascule, contrôle la santé et revient seul à la
version précédente en cas d'échec.

## Images Docker : trois façons de les obtenir

| Source | Commande d'installation de zéro (sur le serveur, en root) | Quand |
|---|---|---|
| **Registre GHCR** (publié par la CI) | `bash installer-serveur.sh --domaine D --email E --registre ghcr.io/devnet8057` | Le plus rapide : rien n'est construit sur le serveur (téléchargement ~1 min) |
| Construction sur le serveur | `bash installer-serveur.sh --domaine D --email E` | Aucun registre ; 3 à 10 min par mise à jour |
| **Archive hors ligne** | `bash installer-serveur.sh --domaine D --email E --archive sgm-cem-<version>.tar` | Serveur sans accès GitHub/Internet sortant restreint |

Le script `installer-serveur.sh` se récupère dans le dépôt (public) ou à la racine de l'archive :
`curl -fsSLO https://raw.githubusercontent.com/DevNet8057/sgm-cem/main/deploy/scripts/installer-serveur.sh`

**Images publiées** par `.github/workflows/images.yml` à chaque push sur `main` (et `claude/**`),
chaque tag `vX.Y.Z` et à la demande (onglet Actions → « Images Docker » → Run workflow) :

| Image | Contenu |
|---|---|
| `ghcr.io/devnet8057/sgm-cem-api` | API Express + worker (`node dist/worker.js`), Chromium et client PostgreSQL 17 inclus |
| `ghcr.io/devnet8057/sgm-cem-web` | Site Next.js autonome (~420 Mo), **indépendant du domaine** : API appelée sur `/api`, ID Google lu à l'exécution |
| `ghcr.io/devnet8057/sgm-cem-proxy` | Passerelle HTTP (Caddy) pour les plateformes à une seule adresse publique (Render…) |

Tags : `sha-<12 caractères du commit>` (utilisé par `deployer.sh`), nom de branche, `X.Y.Z`, `latest` (`main`).
Les paquets GHCR peuvent être **privés à leur première publication** : GitHub → profil →
Packages → `sgm-cem-*` → Package settings → *Change visibility* → Public (sinon :
`REGISTRY_USER` + `REGISTRY_TOKEN` en lecture seule dans le `.env`).

**Archive hors ligne** : artefact du même workflow (14 jours) et pièce jointe de la release
pour un tag `v*` (découpée en `.part-NN` au-delà de 2 Go : `cat sgm-cem-X.tar.part-* > sgm-cem-X.tar`
puis `sha256sum -c sgm-cem-X.tar.sha256`). Elle contient les 7 images (`docker load`), les
fichiers d'exploitation, `manifest.env` et `SHA256SUMS` (vérifiés avant tout chargement).
À la main, sur toute machine disposant des images : `deploy/scripts/creer-archive.sh --help`.

Image à la main (sans script) :
```bash
docker pull ghcr.io/devnet8057/sgm-cem-api:latest
docker save ghcr.io/devnet8057/sgm-cem-api:latest | gzip > sgm-cem-api.tar.gz   # puis : gunzip -c … | docker load
```

## Autres plateformes

| Plateforme | Verdict |
|---|---|
| **VPS** (Hetzner, OVH, Contabo…) | Recommandé, vérifié : scripts ci-dessus, ~5 à 8 €/mois |
| **Render** | `render.yaml` (Blueprint : passerelle publique, web/API/Gotenberg privés, worker, PostgreSQL 17, Key Value). **Non testé sur Render.** Plusieurs services payants : ~60 à 90 $/mois. Renseigner `APP_URL` / `API_URL` = adresse publique de la passerelle |
| Railway, Fly.io, Coolify, Dokploy | Même découpage que Render avec les mêmes images : `sgm-cem-proxy` public (`WEB_UPSTREAM`, `API_UPSTREAM`, `PORT`), le reste privé |
| **Vercel** | **Ne convient pas** : n'exécute pas d'images Docker ni de processus permanents (API Socket.IO, worker BullMQ, Redis, Gotenberg). Seul le site pourrait y être hébergé, en le reconstruisant avec `API_PROXY_URL` pointant vers une API hébergée ailleurs — sans intérêt de coût ni de simplicité ici |

| Depuis votre PC Windows (PowerShell) | Effet |
|---|---|
| `.\deploy\pc\Installer-Serveur.ps1 -Serveur IP -Domaine app.exemple.cm -Email admin@exemple.cm` | Installation complète d'un serveur neuf (une fois) |
| `.\deploy\pc\Deployer.ps1 -Serveur IP` | Mise à jour (après `git push`) |
| `.\deploy\pc\Deployer.ps1 -Serveur IP -Retour` | Retour à la version précédente |
| `.\deploy\pc\Deployer.ps1 -Serveur IP -Etat` | Version en service |
| `… Installer-Serveur.ps1 … -Registre ghcr.io/devnet8057` ou `-Archive .\sgm-cem-X.tar` | Installation depuis les images publiées ou l'archive |
| `.\deploy\pc\Deployer.ps1 -Serveur IP -Archive .\sgm-cem-X.tar` | Mise à jour depuis une archive |

Sur le serveur, les mêmes actions : `/opt/sgm-cem/scripts/deployer.sh [--ref X | --retour | --etat]`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `scripts/installer-serveur.sh` | Serveur neuf : Docker, pare-feu, SSH par clé, mises à jour de sécurité, swap, utilisateur `sgm`, clé de déploiement GitHub, `.env` aux secrets aléatoires, premier déploiement |
| `scripts/deployer.sh` | Code → images (site en ligne pendant la construction) → sauvegarde → bascule → contrôle HTTPS → retour automatique si échec → nettoyage (3 versions gardées, cache plafonné à 4 Go) |
| `scripts/backup.sh` | Sauvegarde quotidienne hors serveur (base + fichiers) avec restic |
| `scripts/restore-test.sh` | Test de restauration mensuel |
| `scripts/creer-archive.sh` | Archive hors ligne : 7 images + exploitation + sommes de contrôle |
| `proxy/` | Image passerelle pour les plateformes (Caddy sans HTTPS, adresses par variables) |
| `render.yaml` | Blueprint Render (non testé) |
| `pc/*.ps1` | Les mêmes commandes lancées depuis Windows (OpenSSH intégré) |
| `docker-compose.prod.yml` | Caddy, web, API, worker, PostgreSQL 17, Redis, Gotenberg ; projet `sgm-cem-prod` |
| `Caddyfile` | HTTPS automatique (Let's Encrypt), en-têtes de sécurité |
| `.env.example` | Variables de production (le `.env` réel est généré par l'installation) |

## Organisation sur le serveur

```
/opt/sgm-cem/
  .env                  secrets (mode 600, jamais versionné) — à copier dans un coffre
  docker-compose.prod.yml, Caddyfile, scripts/   recopiés depuis le code à chaque déploiement
  src/                  clone du dépôt (clé de déploiement en lecture seule)
  backups/              sauvegardes prises avant chaque déploiement (10 dernières)
  .deploy-state         version en service et précédente
  deploy.log            journal des déploiements
```

## Vérifié le 21/10/2026 (environnement de test, domaine `localhost`)

Installation (`--sans-systeme`), premier déploiement, redéploiement, mise à jour ordinaire
(61 s dont ~20 s de bascule), version volontairement cassée (retour automatique en 8 s,
site resté disponible), retour manuel (19 s), HTTPS par Caddy, connexion, PDF par Gotenberg,
Socket.IO, système de fichiers en lecture seule. Corrigés pendant l'essai : client
PostgreSQL 17 dans l'image API, contrôle de santé du worker, démarrage de Chromium
(Gotenberg), cache de construction, nom du projet Compose.

Images portables (même jour) : image web autonome déployée en production d'essai
(site, API et websocket sur la même origine) ; passerelle `sgm-cem-proxy` devant web et API
comme sur une plateforme (site, API, Socket.IO OK) ; **installation complète de zéro depuis
l'archive hors ligne** (`--archive`, 71 s, images vérifiées par SHA256SUMS puis chargées,
conteneurs sains, HTTPS OK). Dans l'environnement d'essai, l'image API d'essai n'embarquait
pas Chromium (dépôts Debian inaccessibles) : les images réelles sont construites par la CI.

**Non vérifié ici** (impossible dans le conteneur d'essai) : les étapes système de
l'installation (apt, ufw, sshd, swap), les scripts PowerShell, le certificat Let's Encrypt
réel, `backup.sh` vers un vrai stockage, le Blueprint Render. À contrôler lors de l'installation du serveur.
