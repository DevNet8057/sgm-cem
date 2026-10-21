# `deploy/` — mise en production par script

Recommandation et justification complètes : `docs/exploitation/09_DEPLOIEMENT_RECOMMANDE.pdf`.
Référence détaillée (sécurité, check-list GO/NO-GO, incidents) : `docs/exploitation/03_GUIDE_DEPLOIEMENT_PRODUCTION.md`.

## En bref

Un serveur Ubuntu 24.04 (x86, 2 vCPU / 4 Go minimum), Docker Compose, Caddy pour le HTTPS.
Les images sont construites **sur le serveur** à partir du dépôt GitHub : pas de registre,
pas de jeton à gérer. Chaque déploiement sauvegarde la base, bascule, contrôle la santé
et revient seul à la version précédente en cas d'échec.

| Depuis votre PC Windows (PowerShell) | Effet |
|---|---|
| `.\deploy\pc\Installer-Serveur.ps1 -Serveur IP -Domaine app.exemple.cm -Email admin@exemple.cm` | Installation complète d'un serveur neuf (une fois) |
| `.\deploy\pc\Deployer.ps1 -Serveur IP` | Mise à jour (après `git push`) |
| `.\deploy\pc\Deployer.ps1 -Serveur IP -Retour` | Retour à la version précédente |
| `.\deploy\pc\Deployer.ps1 -Serveur IP -Etat` | Version en service |

Sur le serveur, les mêmes actions : `/opt/sgm-cem/scripts/deployer.sh [--ref X | --retour | --etat]`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `scripts/installer-serveur.sh` | Serveur neuf : Docker, pare-feu, SSH par clé, mises à jour de sécurité, swap, utilisateur `sgm`, clé de déploiement GitHub, `.env` aux secrets aléatoires, premier déploiement |
| `scripts/deployer.sh` | Code → images (site en ligne pendant la construction) → sauvegarde → bascule → contrôle HTTPS → retour automatique si échec → nettoyage (3 versions gardées, cache plafonné à 4 Go) |
| `scripts/backup.sh` | Sauvegarde quotidienne hors serveur (base + fichiers) avec restic |
| `scripts/restore-test.sh` | Test de restauration mensuel |
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

**Non vérifié ici** (impossible dans le conteneur d'essai) : les étapes système de
l'installation (apt, ufw, sshd, swap), les scripts PowerShell, le certificat Let's Encrypt
réel, `backup.sh` vers un vrai stockage. À contrôler lors de l'installation du serveur.
