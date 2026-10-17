-- Lot 4.5 (EF-M14-04) : interrupteurs déclarés mais jamais lus par le code.
-- Leur historique (system_config_history) est conservé.
DELETE FROM "system_configs" WHERE "key" IN ('FEATURE_OFFLINE_PWA', 'FEATURE_QUERY_BUILDER', 'FEATURE_PERCENT_DISTRIBUTION');
