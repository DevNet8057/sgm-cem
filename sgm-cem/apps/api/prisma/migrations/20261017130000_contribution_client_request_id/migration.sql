-- Clé d'idempotence des contributions saisies par le staff (file hors ligne rejouée).
-- Additive et idempotente : une base adoptée via `db push` possède déjà la colonne.
ALTER TABLE "contributions" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "contributions_clientRequestId_key" ON "contributions"("clientRequestId");
