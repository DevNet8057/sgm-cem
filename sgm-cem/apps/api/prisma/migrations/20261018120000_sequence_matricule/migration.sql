-- Matricule (EF-M02-06) : numéro tiré d'une séquence au lieu de « nombre de comptes + 1 »,
-- qui donnait deux fois le même numéro après une suppression ou deux créations simultanées.
CREATE SEQUENCE IF NOT EXISTS "matricule_seq";

-- Départ après le plus grand numéro déjà attribué (format CEM-AAAA-NNNNNN) ou le nombre de comptes
SELECT setval('"matricule_seq"', GREATEST(m.v, 1), m.v >= 1)
FROM (
  SELECT GREATEST(
    (SELECT COALESCE(MAX(CAST(substring("memberId" FROM '([0-9]+)$') AS BIGINT)), 0) FROM "users" WHERE "memberId" ~ '^CEM-[0-9]{4}-[0-9]+$'),
    (SELECT COALESCE(MAX(CAST(substring("memberId" FROM '([0-9]+)$') AS BIGINT)), 0) FROM "membres" WHERE "memberId" ~ '^CEM-[0-9]{4}-[0-9]+$'),
    (SELECT COUNT(*) FROM "users")
  ) AS v
) m;
