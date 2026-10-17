-- Lot 4.6 : journalisation des exports et des anonymisations (EF-M10-04, EF-M17)
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EXPORT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ANONYMIZE';
