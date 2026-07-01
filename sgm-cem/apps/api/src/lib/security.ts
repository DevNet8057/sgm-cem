export function getJwtSecret(): string {
  return getSecret("JWT_SECRET", "dev-secret", "JWT");
}

export function getRefreshTokenSecret(): string {
  return getSecret("REFRESH_TOKEN_SECRET", "dev-refresh", "refresh token");
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
