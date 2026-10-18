-- Journal d'audit (EF-M13-01) : auteur réel sous impersonation, et journal
-- inaltérable en base — ni suppression, ni modification. Seule exception :
-- l'effacement de l'adresse IP et du navigateur à échéance de conservation (1 an).
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "impersonatedById" TEXT;

CREATE OR REPLACE FUNCTION "audit_logs_inalterable"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'JOURNAL_INALTERABLE : une entrée du journal d''audit ne peut pas être supprimée';
  END IF;
  IF NEW."id" = OLD."id"
     AND NEW."userId" = OLD."userId"
     AND NEW."userName" = OLD."userName"
     AND NEW."action" = OLD."action"
     AND NEW."entityType" = OLD."entityType"
     AND NEW."entityId" IS NOT DISTINCT FROM OLD."entityId"
     AND NEW."details"::text IS NOT DISTINCT FROM OLD."details"::text
     AND NEW."impersonatedById" IS NOT DISTINCT FROM OLD."impersonatedById"
     AND NEW."createdAt" = OLD."createdAt"
     AND (NEW."ipAddress" IS NULL OR NEW."ipAddress" = OLD."ipAddress")
     AND (NEW."userAgent" IS NULL OR NEW."userAgent" = OLD."userAgent") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'JOURNAL_INALTERABLE : une entrée du journal d''audit ne peut pas être modifiée';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "audit_logs_inalterable" ON "audit_logs";
CREATE TRIGGER "audit_logs_inalterable"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_inalterable"();
