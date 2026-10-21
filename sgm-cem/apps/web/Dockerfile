# ──────────────────────────────────────────────────────────────────────
# DOCKERFILE WEB — Frontend Next.js 16 (serveur autonome « standalone »)
#   • Étape « build » : dépendances + next build
#   • Étape finale : uniquement .next/standalone, .next/static et public
#     (pas de node_modules complet, pas d'outils de build) — image légère
# Image PORTABLE : le site appelle l'API sur la même origine (« /api ») ; le
# reverse proxy (Caddy sur un VPS, image sgm-cem-proxy sur une plateforme)
# route /api, /socket.io et /uploads vers l'API. Aucune adresse n'est figée.
# ──────────────────────────────────────────────────────────────────────

# Empreinte épinglée le 17/10/2026 — mise à jour volontaire uniquement
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS build
WORKDIR /app

# ── Variables NEXT_PUBLIC_* : figées AU BUILD par Next.js ──────────────
# Défaut « /api » : même origine, valable pour tout domaine. Le développement
# local (API sur un autre port) passe http://localhost:3001 en argument.
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=""
ARG API_PROXY_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID \
    API_PROXY_URL=$API_PROXY_URL \
    NEXT_TELEMETRY_DISABLED=1

# Manifestes du workspace + package shared (requis par `pnpm install`)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY packages/shared/src ./packages/shared/src
COPY apps/web/package.json ./apps/web/package.json
RUN corepack enable pnpm && pnpm install --filter web... --frozen-lockfile

COPY apps/web/public ./apps/web/public
COPY apps/web/src ./apps/web/src
COPY apps/web/next.config.ts ./apps/web/next.config.ts
COPY apps/web/tsconfig.json ./apps/web/tsconfig.json
COPY apps/web/tailwind.config.ts ./apps/web/tailwind.config.ts
COPY apps/web/postcss.config.mjs ./apps/web/postcss.config.mjs
COPY apps/web/eslint.config.mjs ./apps/web/eslint.config.mjs
RUN pnpm --filter web build && test -f /app/apps/web/.next/standalone/apps/web/server.js

# ── Image d'exécution ──────────────────────────────────────────────────
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# Serveur autonome (avec son node_modules réduit), ressources statiques, public
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
WORKDIR /app/apps/web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

# Traçabilité de l'image (--build-arg GIT_SHA=… --build-arg VERSION=…), déclarée EN DERNIER :
# un ARG qui change à chaque commit invaliderait le cache de toutes les étapes suivantes
# (installation des dépendances comprise) et rallongerait chaque déploiement.
ARG GIT_SHA=dev
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/DevNet8057/sgm-cem" \
      org.opencontainers.image.title="sgm-cem-web" \
      org.opencontainers.image.description="SGM-CEM — site web (Next.js), indépendant du domaine" \
      org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.version="$VERSION"
