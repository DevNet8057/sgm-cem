# `deploy/` — artefacts de production

Fichiers à copier dans `/opt/sgm-cem` sur le serveur. **Le guide normatif est
`docs/exploitation/03_GUIDE_DEPLOIEMENT_PRODUCTION.md`** (check-list GO/NO-GO,
procédures d'installation, de mise à jour et de retour arrière).

| Fichier | Rôle |
|---|---|
| `docker-compose.prod.yml` | Caddy (HTTPS), web, API, PostgreSQL 17, Redis ; réseaux `edge`/`internal` ; images épinglées |
| `Caddyfile` | Reverse proxy, en-têtes de sécurité, `X-Request-Id` ; domaine via `APP_DOMAIN` |
| `.env.example` | Modèle du `.env` de production |
| `scripts/backup.sh` | Sauvegarde quotidienne vérifiée (pg_dump → restic, rétention 7/5/12/10) |
| `scripts/restore-test.sh` | Test de restauration mensuel obligatoire sur base jetable |

Validation avant chaque déploiement : `docker compose -f docker-compose.prod.yml config`.

Vérifié le 17/10/2026 : `docker compose config` (Compose v2.39.4) et
`caddy validate` (Caddy 2.10.2) passent. **Non vérifié** (pas de démon Docker
dans l'environnement du chantier) : construction des images et démarrage réel —
à faire sur le serveur de préproduction avant le GO.

Reste à faire (phase 3) : utilisateur non-root dans les images (impose de
reprendre la propriété des volumes existants), service `worker`, Gotenberg.
