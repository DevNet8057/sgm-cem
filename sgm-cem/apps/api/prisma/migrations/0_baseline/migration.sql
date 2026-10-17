-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('DEVELOPER', 'ADMIN', 'TRESORIER', 'RESPONSABLE', 'ADJOINT_RESPONSABLE', 'COLLECTEUR', 'MEMBRE');

-- CreateEnum
CREATE TYPE "MembreCategorie" AS ENUM ('MCE_EN_SERVICE', 'ENFANTS', 'DIASPORA');

-- CreateEnum
CREATE TYPE "MembreGroupe" AS ENUM ('TEMPLE', 'MVOG_BETSI', 'BISCUITERIE', 'OBILI', 'SCIENCES', 'POLYTECHNIQUE');

-- CreateEnum
CREATE TYPE "MembreStatut" AS ENUM ('EN_OBSERVATION', 'EN_SUIVI', 'FIN_DE_SUIVI', 'DIASPORA');

-- CreateEnum
CREATE TYPE "ProfilFinancier" AS ENUM ('TRAVAILLEUR', 'ETUDIANT', 'COUPLE');

-- CreateEnum
CREATE TYPE "RubriqueType" AS ENUM ('REGULIERE_MENSUELLE', 'PONCTUELLE', 'URGENTE');

-- CreateEnum
CREATE TYPE "RubriquePriority" AS ENUM ('NORMAL', 'PRIORITAIRE', 'URGENT');

-- CreateEnum
CREATE TYPE "RubriqueStatut" AS ENUM ('OUVERTE', 'FERMEE', 'ARCHIVEE');

-- CreateEnum
CREATE TYPE "ContributionStatut" AS ENUM ('EN_ATTENTE_CONFIRMATION', 'CONFIRME', 'LITIGE', 'ANNULE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentBatchStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "ModePaiement" AS ENUM ('ESPECES', 'MTN_MOMO', 'ORANGE_MONEY', 'YELII', 'CARTE_VISA', 'VIREMENT');

-- CreateEnum
CREATE TYPE "TransferType" AS ENUM ('ESPECES_EN_MAIN', 'DEPOT_MTN', 'DEPOT_ORANGE', 'AUTRE');

-- CreateEnum
CREATE TYPE "FundsTransferStatus" AS ENUM ('PENDING_APPROVAL', 'CONFIRMED', 'REFUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LocalisationFonds" AS ENUM ('CHEZ_COLLECTEUR', 'EN_TRANSIT', 'CHEZ_RESPONSABLE', 'REMIS_TRESORIER', 'EN_CAISSE', 'EN_BANQUE', 'PORTEFEUILLE_ELECTRONIQUE');

-- CreateEnum
CREATE TYPE "DocumentStatut" AS ENUM ('BROUILLON', 'EN_ATTENTE', 'APPROUVE', 'REJETE', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "PrestationStatut" AS ENUM ('EN_PREPARATION', 'EN_COURS', 'ENTREES_COMPLETES', 'COMMISSION_VERSEE', 'CLOTURE');

-- CreateEnum
CREATE TYPE "NotificationStatut" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'CONFIRM', 'CONFIRM_OVERRIDE', 'REJECT', 'APPROVE', 'TRANSFER', 'CLAIM', 'TRANSFER_CONFIRMED', 'TRANSFER_REFUSED', 'TRANSFER_CANCELLED', 'DEVELOPER_PANEL_CONFIG_CHANGED', 'IMPERSONATE');

-- CreateEnum
CREATE TYPE "ConfigCategory" AS ENUM ('WEBHOOKS', 'INTEGRATION_KEYS', 'FINANCIAL', 'INFRASTRUCTURE', 'SYSTEM_BEHAVIOR', 'NOTIFICATIONS', 'FEATURE_FLAGS');

-- CreateEnum
CREATE TYPE "DraftStatut" AS ENUM ('ACTIF', 'CONVERTI');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "whatsappPhone" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "photoUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBRE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "notificationToken" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousRefreshToken" TEXT,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membres" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "categorie" "MembreCategorie" NOT NULL,
    "groupe" "MembreGroupe" NOT NULL,
    "statut" "MembreStatut" NOT NULL DEFAULT 'EN_OBSERVATION',
    "profilFinancier" "ProfilFinancier" NOT NULL DEFAULT 'TRAVAILLEUR',
    "phone" TEXT,
    "email" TEXT,
    "adresse" TEXT,
    "photoUrl" TEXT,
    "profession" TEXT,
    "dateAdhesion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateNaissance" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "coupleId" TEXT,
    "nomConjoint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubriques" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "RubriqueType" NOT NULL,
    "priority" "RubriquePriority" NOT NULL DEFAULT 'NORMAL',
    "status" "RubriqueStatut" NOT NULL DEFAULT 'OUVERTE',
    "fiscalYear" INTEGER NOT NULL,
    "openDate" TIMESTAMP(3) NOT NULL,
    "closeDate" TIMESTAMP(3),
    "amountTravailleur" INTEGER,
    "amountEtudiant" INTEGER,
    "amountCouple" INTEGER,
    "targetAmount" INTEGER,
    "targetAll" BOOLEAN NOT NULL DEFAULT false,
    "personnesConcernees" TEXT,
    "isAnnualReference" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rubriques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collectes_publiques" (
    "id" TEXT NOT NULL,
    "rubriqueId" TEXT NOT NULL,
    "publicSlug" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "description" TEXT,
    "champsPersonnalises" JSONB NOT NULL,
    "montantMin" INTEGER,
    "montantsSuggeres" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collectes_publiques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributeurs_externes" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contributeurs_externes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collecte_drafts" (
    "id" TEXT NOT NULL,
    "collecteId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "nom" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "montant" INTEGER,
    "valeursChamps" JSONB,
    "statut" "DraftStatut" NOT NULL DEFAULT 'ACTIF',
    "contributionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collecte_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributions" (
    "id" TEXT NOT NULL,
    "membreId" TEXT,
    "rubriqueId" TEXT NOT NULL,
    "collecteurId" TEXT,
    "montant" INTEGER NOT NULL,
    "montantAttendu" INTEGER,
    "modePaiement" "ModePaiement" NOT NULL,
    "statut" "ContributionStatut" NOT NULL DEFAULT 'EN_ATTENTE_CONFIRMATION',
    "localisationFonds" "LocalisationFonds" NOT NULL DEFAULT 'CHEZ_COLLECTEUR',
    "periodeLabel" TEXT,
    "referencePaiement" TEXT,
    "mobileMoneyPhone" TEXT,
    "momoTransactionId" TEXT,
    "note" TEXT,
    "contributeurExterneId" TEXT,
    "valeursChamps" JSONB,
    "externalTransactionId" TEXT,
    "paymentStatus" "PaymentStatus" DEFAULT 'PENDING',
    "netAmount" INTEGER,
    "paymentUrl" TEXT,
    "paymentBatchId" TEXT,
    "amountChargedToPayer" INTEGER,
    "commissionPaidByPayer" INTEGER,
    "litigeMotif" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "confirmationAuthorization" JSONB,
    "receiptUrl" TEXT,
    "receiptSentAt" TIMESTAMP(3),
    "proofUrl" TEXT,
    "proofUploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "transferId" TEXT,
    "bankDepositId" TEXT,

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_batches" (
    "id" TEXT NOT NULL,
    "membreId" TEXT,
    "budget" INTEGER NOT NULL,
    "allocations" JSONB NOT NULL,
    "totalAllocated" INTEGER NOT NULL,
    "status" "PaymentBatchStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "externalTransactionId" TEXT,
    "paymentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_deposits" (
    "id" TEXT NOT NULL,
    "referenceBordereau" TEXT NOT NULL,
    "dateBordereau" TIMESTAMP(3),
    "note" TEXT,
    "totalAmount" INTEGER NOT NULL,
    "depositedById" TEXT NOT NULL,
    "depositedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funds_transfers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "refusedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "receiverName" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "transferType" "TransferType" NOT NULL DEFAULT 'ESPECES_EN_MAIN',
    "status" "FundsTransferStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "senderNote" TEXT,
    "refusalReason" TEXT,
    "borderauUrl" TEXT,
    "remindersSentCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderSentAt" TIMESTAMP(3),

    CONSTRAINT "funds_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "description" TEXT,
    "responsableId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "type_documents" (
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "retentionAnnees" INTEGER NOT NULL,

    CONSTRAINT "type_documents_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "commissionId" TEXT NOT NULL,
    "typeCode" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "description" TEXT,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "s3Bucket" TEXT NOT NULL,
    "statut" "DocumentStatut" NOT NULL DEFAULT 'BROUILLON',
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploadedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejetMotif" TEXT,
    "expiresAt" TIMESTAMP(3),
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prestations" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "description" TEXT,
    "commanditaire" TEXT NOT NULL,
    "commanditairePhone" TEXT,
    "statut" "PrestationStatut" NOT NULL DEFAULT 'EN_PREPARATION',
    "tarifBase" INTEGER NOT NULL,
    "rabaisCommanditaire" INTEGER NOT NULL DEFAULT 0,
    "rabaisPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tarifFinal" INTEGER NOT NULL,
    "acompte" INTEGER NOT NULL DEFAULT 0,
    "solde" INTEGER NOT NULL DEFAULT 0,
    "totalEntrees" INTEGER NOT NULL DEFAULT 0,
    "totalCours" INTEGER NOT NULL DEFAULT 0,
    "commission" INTEGER,
    "commissionPercent" DOUBLE PRECISION NOT NULL DEFAULT 35,
    "commissionVerseeAt" TIMESTAMP(3),
    "dateEvenement" TIMESTAMP(3),
    "lieu" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prestations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cours_prestations" (
    "id" TEXT NOT NULL,
    "prestationId" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "montant" INTEGER NOT NULL,
    "justificatif" TEXT,
    "s3Key" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cours_prestations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entrees_prestations" (
    "id" TEXT NOT NULL,
    "prestationId" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "montant" INTEGER NOT NULL,
    "modePaiement" "ModePaiement" NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entrees_prestations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "defaultIncreaseRate" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "etudiantRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "coupleRatio" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "inactivityMonthsThreshold" INTEGER NOT NULL DEFAULT 6,
    "reminderDelayDays" INTEGER NOT NULL DEFAULT 7,
    "maxFundsRetentionDays" INTEGER NOT NULL DEFAULT 7,
    "transferPendingReminderHours" INTEGER NOT NULL DEFAULT 24,
    "transferAlertTresorierHours" INTEGER NOT NULL DEFAULT 48,
    "communityName" TEXT NOT NULL DEFAULT 'Culte d''Enfants de Melen',
    "communityVerse" TEXT NOT NULL DEFAULT 'Or, à celui qui peut faire...',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'LOGIN',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" "ConfigCategory" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "isEditable" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config_history" (
    "id" TEXT NOT NULL,
    "configKey" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedByName" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_config_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetView" TEXT,
    "targetId" TEXT,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "statut" "NotificationStatut" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_sessions" (
    "id" TEXT NOT NULL,
    "authSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authExpiresAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3),
    "lastAccountedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "activity_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_tabs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tabId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "pageKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "activity_tabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_page_aggregates" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "pageKey" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_page_aggregates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_memberId_key" ON "users"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refreshToken_key" ON "user_sessions"("refreshToken");

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "user_sessions"("userId");

-- CreateIndex
CREATE INDEX "user_sessions_previousRefreshToken_idx" ON "user_sessions"("previousRefreshToken");

-- CreateIndex
CREATE UNIQUE INDEX "membres_userId_key" ON "membres"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "membres_memberId_key" ON "membres"("memberId");

-- CreateIndex
CREATE INDEX "membres_groupe_idx" ON "membres"("groupe");

-- CreateIndex
CREATE INDEX "membres_statut_idx" ON "membres"("statut");

-- CreateIndex
CREATE INDEX "membres_categorie_idx" ON "membres"("categorie");

-- CreateIndex
CREATE UNIQUE INDEX "rubriques_code_key" ON "rubriques"("code");

-- CreateIndex
CREATE INDEX "rubriques_status_idx" ON "rubriques"("status");

-- CreateIndex
CREATE INDEX "rubriques_fiscalYear_idx" ON "rubriques"("fiscalYear");

-- CreateIndex
CREATE INDEX "rubriques_priority_idx" ON "rubriques"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "collectes_publiques_rubriqueId_key" ON "collectes_publiques"("rubriqueId");

-- CreateIndex
CREATE UNIQUE INDEX "collectes_publiques_publicSlug_key" ON "collectes_publiques"("publicSlug");

-- CreateIndex
CREATE INDEX "collectes_publiques_isActive_idx" ON "collectes_publiques"("isActive");

-- CreateIndex
CREATE INDEX "contributeurs_externes_phone_idx" ON "contributeurs_externes"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "collecte_drafts_tokenHash_key" ON "collecte_drafts"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "collecte_drafts_contributionId_key" ON "collecte_drafts"("contributionId");

-- CreateIndex
CREATE INDEX "collecte_drafts_phone_idx" ON "collecte_drafts"("phone");

-- CreateIndex
CREATE INDEX "collecte_drafts_expiresAt_idx" ON "collecte_drafts"("expiresAt");

-- CreateIndex
CREATE INDEX "contributions_statut_idx" ON "contributions"("statut");

-- CreateIndex
CREATE INDEX "contributions_membreId_idx" ON "contributions"("membreId");

-- CreateIndex
CREATE INDEX "contributions_rubriqueId_idx" ON "contributions"("rubriqueId");

-- CreateIndex
CREATE INDEX "contributions_contributeurExterneId_idx" ON "contributions"("contributeurExterneId");

-- CreateIndex
CREATE INDEX "contributions_externalTransactionId_idx" ON "contributions"("externalTransactionId");

-- CreateIndex
CREATE INDEX "contributions_paymentStatus_idx" ON "contributions"("paymentStatus");

-- CreateIndex
CREATE INDEX "contributions_paymentBatchId_idx" ON "contributions"("paymentBatchId");

-- CreateIndex
CREATE INDEX "contributions_createdAt_idx" ON "contributions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_batches_idempotencyKey_key" ON "payment_batches"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "payment_batches_requestFingerprint_key" ON "payment_batches"("requestFingerprint");

-- CreateIndex
CREATE INDEX "payment_batches_membreId_idx" ON "payment_batches"("membreId");

-- CreateIndex
CREATE INDEX "payment_batches_status_idx" ON "payment_batches"("status");

-- CreateIndex
CREATE INDEX "payment_batches_externalTransactionId_idx" ON "payment_batches"("externalTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- CreateIndex
CREATE INDEX "bank_deposits_createdAt_idx" ON "bank_deposits"("createdAt");

-- CreateIndex
CREATE INDEX "bank_deposits_referenceBordereau_idx" ON "bank_deposits"("referenceBordereau");

-- CreateIndex
CREATE INDEX "funds_transfers_senderId_idx" ON "funds_transfers"("senderId");

-- CreateIndex
CREATE INDEX "funds_transfers_receiverId_idx" ON "funds_transfers"("receiverId");

-- CreateIndex
CREATE INDEX "funds_transfers_status_idx" ON "funds_transfers"("status");

-- CreateIndex
CREATE INDEX "funds_transfers_createdAt_idx" ON "funds_transfers"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_nom_key" ON "commissions"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "documents_s3Key_key" ON "documents"("s3Key");

-- CreateIndex
CREATE INDEX "documents_commissionId_idx" ON "documents"("commissionId");

-- CreateIndex
CREATE INDEX "documents_statut_idx" ON "documents"("statut");

-- CreateIndex
CREATE UNIQUE INDEX "prestations_reference_key" ON "prestations"("reference");

-- CreateIndex
CREATE INDEX "prestations_statut_idx" ON "prestations"("statut");

-- CreateIndex
CREATE INDEX "otp_codes_phone_idx" ON "otp_codes"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "system_configs_key_key" ON "system_configs"("key");

-- CreateIndex
CREATE INDEX "system_configs_category_idx" ON "system_configs"("category");

-- CreateIndex
CREATE INDEX "system_config_history_configKey_idx" ON "system_config_history"("configKey");

-- CreateIndex
CREATE INDEX "system_config_history_createdAt_idx" ON "system_config_history"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "activity_sessions_authSessionId_key" ON "activity_sessions"("authSessionId");

-- CreateIndex
CREATE INDEX "activity_sessions_userId_startedAt_idx" ON "activity_sessions"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "activity_sessions_lastSeenAt_idx" ON "activity_sessions"("lastSeenAt");

-- CreateIndex
CREATE INDEX "activity_sessions_endedAt_authExpiresAt_idx" ON "activity_sessions"("endedAt", "authExpiresAt");

-- CreateIndex
CREATE INDEX "activity_tabs_lastSeenAt_idx" ON "activity_tabs"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "activity_tabs_sessionId_tabId_key" ON "activity_tabs"("sessionId", "tabId");

-- CreateIndex
CREATE INDEX "activity_page_aggregates_day_pageKey_idx" ON "activity_page_aggregates"("day", "pageKey");

-- CreateIndex
CREATE UNIQUE INDEX "activity_page_aggregates_sessionId_pageKey_day_key" ON "activity_page_aggregates"("sessionId", "pageKey", "day");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membres" ADD CONSTRAINT "membres_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membres" ADD CONSTRAINT "membres_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "membres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rubriques" ADD CONSTRAINT "rubriques_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collectes_publiques" ADD CONSTRAINT "collectes_publiques_rubriqueId_fkey" FOREIGN KEY ("rubriqueId") REFERENCES "rubriques"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collecte_drafts" ADD CONSTRAINT "collecte_drafts_collecteId_fkey" FOREIGN KEY ("collecteId") REFERENCES "collectes_publiques"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "funds_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_bankDepositId_fkey" FOREIGN KEY ("bankDepositId") REFERENCES "bank_deposits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "membres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_rubriqueId_fkey" FOREIGN KEY ("rubriqueId") REFERENCES "rubriques"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_collecteurId_fkey" FOREIGN KEY ("collecteurId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_contributeurExterneId_fkey" FOREIGN KEY ("contributeurExterneId") REFERENCES "contributeurs_externes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_paymentBatchId_fkey" FOREIGN KEY ("paymentBatchId") REFERENCES "payment_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_batches" ADD CONSTRAINT "payment_batches_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "membres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_depositedById_fkey" FOREIGN KEY ("depositedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funds_transfers" ADD CONSTRAINT "funds_transfers_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funds_transfers" ADD CONSTRAINT "funds_transfers_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "commissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_typeCode_fkey" FOREIGN KEY ("typeCode") REFERENCES "type_documents"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cours_prestations" ADD CONSTRAINT "cours_prestations_prestationId_fkey" FOREIGN KEY ("prestationId") REFERENCES "prestations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrees_prestations" ADD CONSTRAINT "entrees_prestations_prestationId_fkey" FOREIGN KEY ("prestationId") REFERENCES "prestations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_tabs" ADD CONSTRAINT "activity_tabs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "activity_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_page_aggregates" ADD CONSTRAINT "activity_page_aggregates_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "activity_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

