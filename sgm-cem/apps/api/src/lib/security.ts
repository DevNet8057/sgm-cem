export function getJwtSecret(): string {
  return getSecret("JWT_SECRET", "dev-secret", "JWT");
}

export function getRefreshTokenSecret(): string {
  return getSecret("REFRESH_TOKEN_SECRET", "dev-refresh", "refresh token");
}

export function getCsrfSecret(): string {
  return getSecret("CSRF_SECRET", "csrf-dev-secret-change-in-prod", "CSRF");
}

/**
 * Nombre de proxys de confiance devant l'API (Caddy en production) : sans
 * cela, req.ip vaut l'IP du proxy et toute limitation par IP est commune.
 * TRUST_PROXY=0 pour une API exposée directement.
 */
export function getTrustProxy(): number | boolean {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === "") return process.env.NODE_ENV === "production" ? 1 : false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  const hops = Number(raw);
  return Number.isInteger(hops) && hops >= 0 ? hops : 1;
}

function getSecret(envName: string, fallback: string, label: string): string {
  const value = process.env[envName] ?? fallback;

  // Validation en production
  if (process.env.NODE_ENV === "production") {
    if (!process.env[envName] || value === fallback) {
      throw new Error(
        `❌ ${label} secret is not configured. Set ${envName} environment variable.`,
      );
    }
    if (value.length < 32) {
      throw new Error(
        `❌ ${label} secret must be at least 32 characters long for production`,
      );
    }
  }

  // Avertissement en développement
  if (process.env.NODE_ENV !== "production" && value === fallback) {
    console.warn(
      `⚠️  Using default ${label} secret. Set ${envName} for production.`,
    );
  }

  return value;
}
