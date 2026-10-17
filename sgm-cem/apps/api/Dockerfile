# ──────────────────────────────────────────────────────────────────────
# DOCKERFILE API — Backend Express + TypeScript + Prisma
# Pourquoi node:24-bookworm-slim ?
#   • Node 24 LTS (Node 20 en fin de vie depuis le 30/04/2026 ; Puppeteer 25 exige Node >= 22.12)
#   • bookworm figé : noms de paquets apt stables (trixie renomme libasound2…)
#   • slim = image légère mais apt-get disponible pour Puppeteer/Chromium
# ──────────────────────────────────────────────────────────────────────

# Empreinte épinglée le 17/10/2026 — mise à jour volontaire uniquement
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

# Traçabilité de l'image (renseignées par la CI : --build-arg GIT_SHA=… --build-arg VERSION=…)
ARG GIT_SHA=dev
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/DevNet8057/sgm-cem" \
      org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.version="$VERSION"

# ── Étape 1 : apt-get pour Puppeteer / Chromium + Prisma ───────────────
# Puppeteer a besoin de bibliothèques système pour lancer Chromium.
# openssl : TLS vers PostgreSQL (Prisma 7 n'embarque plus de moteur natif).
# postgresql-client : pg_isready dans l'entrypoint.
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
    postgresql-client \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

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

# ── Étape 10 : Exposer le port ─────────────────────────────────────────
EXPOSE 3001

# ── Étape 11 : Healthcheck + point d'entrée ────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health',(r)=>{process.exit(r.statusCode===200?0:1)})" || exit 1
CMD ["/app/docker-entrypoint.sh"]
