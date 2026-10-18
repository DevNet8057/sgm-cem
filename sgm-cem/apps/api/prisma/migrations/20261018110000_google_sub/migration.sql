-- Connexion Google : compte rattaché à l'identifiant Google (sub), pas seulement à l'adresse
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "googleSub" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_googleSub_key" ON "users"("googleSub");
