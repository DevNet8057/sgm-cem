# ──────────────────────────────────────────────────────────────────────
# DOCKERFILE API — Backend Express + TypeScript + Prisma
# Pourquoi node:24-bookworm-slim ?
#   • Node 24 LTS (Node 20 en fin de vie depuis le 30/04/2026 ; Puppeteer 25 exige Node >= 22.12)
#   • bookworm figé : noms de paquets apt stables (trixie renomme libasound2…)
#   • slim = image légère mais apt-get disponible pour Puppeteer/Chromium
# ──────────────────────────────────────────────────────────────────────

# ── Client PostgreSQL 17 (pg_dump, pg_restore, psql, pg_isready) ──────
# Le serveur de production est PostgreSQL 17 : pg_dump refuse de sauvegarder un
# serveur plus récent que lui, et la sauvegarde avant démarrage est obligatoire.
# Le paquet Debian bookworm n'existe qu'en version 15 : on reprend les outils de
# l'image officielle postgres:17-bookworm (même empreinte que la production).
FROM postgres:17-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826 AS pgclient
RUN mkdir -p /out/bin /out/lib \
  && for b in pg_dump pg_restore pg_isready psql; do \
       cp /usr/lib/postgresql/17/bin/$b /out/bin/; \
       ldd /usr/lib/postgresql/17/bin/$b | awk '/=>/{print $3}' | grep -vE 'libc\.so|libm\.so|libresolv' | xargs -r -I{} cp -Ln {} /out/lib/; \
     done

# Empreinte épinglée le 17/10/2026 — mise à jour volontaire uniquement
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5


# ── Étape 1 : apt-get pour Puppeteer / Chromium + Prisma ───────────────
# Puppeteer a besoin de bibliothèques système pour lancer Chromium.
# openssl : TLS vers PostgreSQL (Prisma 7 n'embarque plus de moteur natif).
RUN apt-get -o Acquire::Check-Valid-Until=false update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxshmfence1 \
    libxss1 \
    lsb-release \
    openssl \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# Client PostgreSQL 17 et ses bibliothèques (libpq…) ; celles déjà fournies par
# Debian ne sont pas remplacées (cp -n)
COPY --from=pgclient /out/bin/ /usr/local/bin/
COPY --from=pgclient /out/lib/ /tmp/pglibs/
RUN cp -n /tmp/pglibs/* /usr/lib/x86_64-linux-gnu/ && rm -rf /tmp/pglibs && ldconfig \
  && pg_dump --version | grep -q ' 17\.'

# ── Étape 2 : Définir le chemin de Chromium pour Puppeteer ─────────────
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# ── Étape 3 : Répertoire de travail ────────────────────────────────────
WORKDIR /app

# ── Étape 4 : Manifestes du workspace + package shared ─────────────────
# Le package @sgm-cem/shared (workspace:*) est une dépendance de l'API :
# il DOIT être présent avant `pnpm install`, sinon la résolution échoue.
# Son source est copié aussi car le postinstall racine lance `pnpm build:shared`.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY packages/shared/src ./packages/shared/src
COPY apps/api/package.json ./apps/api/package.json

# ── Étape 5 : Installer les dépendances (api + ses deps workspace) ─────
# `--filter api...` = api ET ses dépendances workspace (@sgm-cem/shared).
RUN corepack enable pnpm && pnpm install --filter api... --frozen-lockfile

# ── Étape 6 : Copier le code source de l'API ───────────────────────────
COPY apps/api/src ./apps/api/src
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY apps/api/prisma.config.ts ./apps/api/prisma.config.ts

# ── Étape 7 : Générer le client Prisma (crée les types TypeScript) ─────
RUN cd /app/apps/api && pnpm exec prisma generate

# ── Étape 8 : Builder le TypeScript ─────────────────────────────────────
# Une erreur de type fait échouer le build : jamais d'image construite sur du code faux.
RUN pnpm --filter api build \
  && test -f /app/apps/api/dist/index.js

# ── Étape 9 : Point d'entrée : attente PostgreSQL, sauvegarde, migrations
# (`migrate deploy`), seed de base si la base est vide, puis serveur.
COPY apps/api/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

# Dossiers écrits par l'application, appartenant à l'utilisateur node (uid 1000) :
# un volume nommé neuf hérite de ces droits. Le serveur ne tourne jamais en root
# (Compose de production : user 1000 ; sinon l'entrypoint abandonne les privilèges).
RUN mkdir -p /app/apps/api/uploads /app/apps/api/backups \
  && chown -R node:node /app/apps/api/uploads /app/apps/api/backups

# ── Étape 10 : Exposer le port ─────────────────────────────────────────
EXPOSE 3001

# ── Étape 11 : Healthcheck + point d'entrée ────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health',(r)=>{process.exit(r.statusCode===200?0:1)})" || exit 1
CMD ["/app/docker-entrypoint.sh"]

# Traçabilité de l'image (--build-arg GIT_SHA=… --build-arg VERSION=…), déclarée EN DERNIER :
# un ARG qui change à chaque commit invaliderait le cache de toutes les étapes suivantes
# (installation des dépendances comprise) et rallongerait chaque déploiement.
ARG GIT_SHA=dev
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/DevNet8057/sgm-cem" \
      org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.version="$VERSION"
