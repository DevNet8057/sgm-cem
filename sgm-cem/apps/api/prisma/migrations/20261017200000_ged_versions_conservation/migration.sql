-- Lot 4.7 : GED — versions (EF-M11-05) et conservation (EF-M11-04)
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "expiryNotifiedAt" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "parentId" TEXT;

CREATE INDEX IF NOT EXISTS "documents_parentId_idx" ON "documents"("parentId");
CREATE INDEX IF NOT EXISTS "documents_expiresAt_idx" ON "documents"("expiresAt");
