-- Connexion par code (EF-M01-02) : numéros au format E.164 (+237…) et numéro
-- WhatsApp unique. Seuls les formats camerounais sans ambiguïté sont convertis,
-- et jamais vers un numéro déjà porté par un autre compte.

-- 9 chiffres (local) → +237…
UPDATE "users" u SET "phone" = '+237' || u."phone"
WHERE u."phone" ~ '^[0-9]{9}$'
  AND NOT EXISTS (SELECT 1 FROM "users" o WHERE o."phone" = '+237' || u."phone");
UPDATE "users" u SET "whatsappPhone" = '+237' || u."whatsappPhone"
WHERE u."whatsappPhone" ~ '^[0-9]{9}$'
  AND NOT EXISTS (SELECT 1 FROM "users" o WHERE o."whatsappPhone" = '+237' || u."whatsappPhone");
UPDATE "membres" SET "phone" = '+237' || "phone" WHERE "phone" ~ '^[0-9]{9}$';

-- 237 + 9 chiffres → +237…
UPDATE "users" u SET "phone" = '+' || u."phone"
WHERE u."phone" ~ '^237[0-9]{9}$'
  AND NOT EXISTS (SELECT 1 FROM "users" o WHERE o."phone" = '+' || u."phone");
UPDATE "users" u SET "whatsappPhone" = '+' || u."whatsappPhone"
WHERE u."whatsappPhone" ~ '^237[0-9]{9}$'
  AND NOT EXISTS (SELECT 1 FROM "users" o WHERE o."whatsappPhone" = '+' || u."whatsappPhone");
UPDATE "membres" SET "phone" = '+' || "phone" WHERE "phone" ~ '^237[0-9]{9}$';

-- Numéro WhatsApp unique, si aucun doublon ne subsiste (sinon : à corriger à la main,
-- l'application refuse déjà un numéro WhatsApp pris par un autre compte)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "users" WHERE "whatsappPhone" IS NOT NULL GROUP BY "whatsappPhone" HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "users_whatsappPhone_key" ON "users"("whatsappPhone");
  ELSE
    RAISE NOTICE 'Numéros WhatsApp en double : index unique non créé, à corriger puis relancer';
  END IF;
END $$;
