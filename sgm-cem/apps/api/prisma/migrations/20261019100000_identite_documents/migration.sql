-- Identité imprimée sur les documents (adresse, contacts, numéro d'enregistrement)
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "communityAddress" TEXT NOT NULL DEFAULT 'Église Évangélique du Cameroun, paroisse de Melen — Yaoundé, Cameroun';
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "communityPhone" TEXT;
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "communityEmail" TEXT;
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "communityLegalId" TEXT;
