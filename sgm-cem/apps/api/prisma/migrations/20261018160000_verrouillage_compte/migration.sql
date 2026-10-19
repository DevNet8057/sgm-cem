-- Verrouillage d'un compte après 5 échecs de connexion d'affilée (15 minutes)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3);
