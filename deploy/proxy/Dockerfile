# ──────────────────────────────────────────────────────────────────────
# Passerelle SGM-CEM (image « sgm-cem-proxy ») — pour les plateformes qui
# donnent une adresse publique par service. Inutile sur un VPS (Caddy du
# docker-compose.prod.yml, avec HTTPS automatique).
# ──────────────────────────────────────────────────────────────────────
FROM caddy:2.11-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
COPY Caddyfile /etc/caddy/Caddyfile
# Sans root : données et configuration de Caddy dans /tmp
ENV PORT=8080 XDG_DATA_HOME=/tmp/caddy/data XDG_CONFIG_HOME=/tmp/caddy/config
# Configuration validée à la construction (adresses fictives)
RUN WEB_UPSTREAM=web:3000 API_UPSTREAM=api:3001 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
USER 65534:65534
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" > /dev/null || exit 1

ARG GIT_SHA=dev
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/DevNet8057/sgm-cem" \
      org.opencontainers.image.title="sgm-cem-proxy" \
      org.opencontainers.image.description="SGM-CEM — passerelle (site + API sur une seule adresse) pour plateformes" \
      org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.version="$VERSION"
