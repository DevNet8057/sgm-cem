export function getJwtSecret(): string {
  return getSecret('JWT_SECRET', 'dev-secret', 'JWT')
}

export function getRefreshTokenSecret(): string {
  return getSecret('REFRESH_TOKEN_SECRET', 'dev-refresh', 'refresh token')
}

function getSecret(envName: string, fallback: string, label: string): string {
  const value = process.env[envName] ?? fallback
  if (process.env.NODE_ENV === 'production' && (value === fallback || value.length < 32)) {
    throw new Error(`${label} secret is not configured securely`)
  }
  return value
}
