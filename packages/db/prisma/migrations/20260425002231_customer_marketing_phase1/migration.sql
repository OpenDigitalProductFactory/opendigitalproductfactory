DO $$
BEGIN
    CREATE TYPE "AiProviderFinanceStatus" AS ENUM ('draft', 'active', 'needs_plan_details', 'archived');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "SupplierContractStatus" AS ENUM ('draft', 'active', 'suspended', 'terminated');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "SupplierContractType" AS ENUM ('subscription', 'metered', 'hybrid');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "SupplierContractBillingCadence" AS ENUM ('monthly', 'quarterly', 'annual', 'custom');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "AiProviderReconciliationStrategy" AS ENUM ('internal_only', 'provider_api', 'manual_review', 'hybrid');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "ContractAllowanceValuationMethod" AS ENUM ('prorated_commitment', 'explicit_unit_value', 'none');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "FinanceWorkItemType" AS ENUM ('plan_details_needed', 'billing_url_missing', 'usage_source_missing', 'reconciliation_review', 'underuse_attention', 'critical_low_remaining');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "FinanceWorkItemStatus" AS ENUM ('open', 'in_progress', 'done', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "UsageSnapshotDataSource" AS ENUM ('provider_api', 'internal_usage', 'manual');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "UsageSnapshotDataConfidence" AS ENUM ('high', 'medium', 'low');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "MarketingStrategy" (
    "strategyId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storefrontId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "primaryGoal" TEXT,
    "routeToMarket" TEXT NOT NULL DEFAULT 'hybrid',
    "localityModel" TEXT NOT NULL DEFAULT 'regional',
    "geographicScope" TEXT,
    "serviceTerritories" JSONB,
    "targetSegments" JSONB,
    "idealCustomerProfiles" JSONB,
    "entryOffers" JSONB,
    "primaryChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secondaryChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "differentiators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "proofAssets" JSONB,
    "seasonalityNotes" TEXT,
    "constraints" JSONB,
    "reviewCadence" TEXT NOT NULL DEFAULT 'quarterly',
    "lastReviewedAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "sourceSummary" TEXT,
    "specialistNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingStrategy_pkey" PRIMARY KEY ("strategyId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MarketingReview" (
    "reviewId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "reviewType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detectedChanges" JSONB,
    "funnelAssessment" JSONB,
    "suggestedActions" JSONB,
    "stalenessSignals" JSONB,
    "createdByAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingReview_pkey" PRIMARY KEY ("reviewId")
);

CREATE TABLE IF NOT EXISTS "AiProviderFinanceProfile" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "AiProviderFinanceStatus" NOT NULL DEFAULT 'draft',
    "billingPortalUrl" TEXT,
    "usageDashboardUrl" TEXT,
    "invoiceHistoryUrl" TEXT,
    "reconciliationStrategy" "AiProviderReconciliationStrategy" NOT NULL DEFAULT 'hybrid',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderFinanceProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupplierContract" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "providerFinanceProfileId" TEXT NOT NULL,
    "status" "SupplierContractStatus" NOT NULL DEFAULT 'draft',
    "contractType" "SupplierContractType" NOT NULL DEFAULT 'subscription',
    "billingCadence" "SupplierContractBillingCadence" NOT NULL DEFAULT 'monthly',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "monthlyCommittedAmount" DECIMAL(12,2),
    "budgetOwnerEmployeeId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierContract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ContractAllowance" (
    "id" TEXT NOT NULL,
    "supplierContractId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "metricScope" TEXT,
    "scopeRef" TEXT,
    "includedQuantity" DECIMAL(18,4) NOT NULL,
    "softLowThresholdPct" DECIMAL(5,2),
    "criticalLowThresholdPct" DECIMAL(5,2),
    "underuseThresholdPct" DECIMAL(5,2),
    "valuationMethod" "ContractAllowanceValuationMethod" NOT NULL DEFAULT 'prorated_commitment',
    "explicitUnitValue" DECIMAL(12,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractAllowance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ContractUsageSnapshot" (
    "id" TEXT NOT NULL,
    "contractAllowanceId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "consumedQuantity" DECIMAL(18,4) NOT NULL,
    "remainingQuantity" DECIMAL(18,4) NOT NULL,
    "utilizationPct" DECIMAL(5,2) NOT NULL,
    "estimatedUnusedValue" DECIMAL(12,2) NOT NULL,
    "projectedPeriodEndQuantity" DECIMAL(18,4) NOT NULL,
    "projectedPeriodEndUtilizationPct" DECIMAL(5,2) NOT NULL,
    "projectedOverageQuantity" DECIMAL(18,4) NOT NULL,
    "dataSource" "UsageSnapshotDataSource" NOT NULL,
    "dataConfidence" "UsageSnapshotDataConfidence" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractUsageSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FinanceWorkItem" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "type" "FinanceWorkItemType" NOT NULL,
    "status" "FinanceWorkItemStatus" NOT NULL DEFAULT 'open',
    "providerFinanceProfileId" TEXT NOT NULL,
    "supplierContractId" TEXT,
    "assignedEmployeeId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceWorkItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AiProviderFinanceProfile"
    ADD COLUMN IF NOT EXISTS "billingPortalUrl" TEXT,
    ADD COLUMN IF NOT EXISTS "usageDashboardUrl" TEXT,
    ADD COLUMN IF NOT EXISTS "invoiceHistoryUrl" TEXT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'AiProviderFinanceProfile'
          AND column_name = 'billingUrl'
    ) THEN
        EXECUTE 'UPDATE "AiProviderFinanceProfile"
                 SET "billingPortalUrl" = COALESCE("billingPortalUrl", "billingUrl")
                 WHERE "billingUrl" IS NOT NULL';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'AiProviderFinanceProfile'
          AND column_name = 'usageUrl'
    ) THEN
        EXECUTE 'UPDATE "AiProviderFinanceProfile"
                 SET "usageDashboardUrl" = COALESCE("usageDashboardUrl", "usageUrl")
                 WHERE "usageUrl" IS NOT NULL';
    END IF;
END $$;

UPDATE "AiProviderFinanceProfile"
SET "status" = CASE
        WHEN "status" = 'seeded' THEN 'active'
        ELSE "status"
    END,
    "reconciliationStrategy" = CASE
        WHEN "reconciliationStrategy" = 'provider_portal' THEN 'provider_api'
        ELSE "reconciliationStrategy"
    END;

ALTER TABLE "SupplierContract"
    ADD COLUMN IF NOT EXISTS "providerFinanceProfileId" TEXT,
    ADD COLUMN IF NOT EXISTS "budgetOwnerEmployeeId" TEXT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'SupplierContract'
          AND column_name = 'profileId'
    ) THEN
        EXECUTE 'UPDATE "SupplierContract"
                 SET "providerFinanceProfileId" = COALESCE("providerFinanceProfileId", "profileId")
                 WHERE "profileId" IS NOT NULL';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'SupplierContract'
          AND column_name = 'accountableEmployeeId'
    ) THEN
        EXECUTE 'UPDATE "SupplierContract"
                 SET "budgetOwnerEmployeeId" = COALESCE("budgetOwnerEmployeeId", "accountableEmployeeId")
                 WHERE "accountableEmployeeId" IS NOT NULL';
    END IF;
END $$;

ALTER TABLE "ContractAllowance"
    ADD COLUMN IF NOT EXISTS "supplierContractId" TEXT,
    ADD COLUMN IF NOT EXISTS "metricKey" TEXT,
    ADD COLUMN IF NOT EXISTS "metricScope" TEXT,
    ADD COLUMN IF NOT EXISTS "scopeRef" TEXT,
    ADD COLUMN IF NOT EXISTS "softLowThresholdPct" DECIMAL(5,2),
    ADD COLUMN IF NOT EXISTS "criticalLowThresholdPct" DECIMAL(5,2),
    ADD COLUMN IF NOT EXISTS "underuseThresholdPct" DECIMAL(5,2),
    ADD COLUMN IF NOT EXISTS "explicitUnitValue" DECIMAL(12,4);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ContractAllowance'
          AND column_name = 'contractId'
    ) THEN
        EXECUTE 'UPDATE "ContractAllowance"
                 SET "supplierContractId" = COALESCE("supplierContractId", "contractId")
                 WHERE "contractId" IS NOT NULL';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ContractAllowance'
          AND column_name = 'allowanceName'
    ) THEN
        EXECUTE 'UPDATE "ContractAllowance"
                 SET "metricKey" = COALESCE("metricKey", NULLIF("allowanceName", ''''))
                 WHERE "allowanceName" IS NOT NULL';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ContractAllowance'
          AND column_name = 'usageUnit'
    ) THEN
        EXECUTE 'UPDATE "ContractAllowance"
                 SET "metricKey" = COALESCE("metricKey", NULLIF("usageUnit", ''''))
                 WHERE "usageUnit" IS NOT NULL';
    END IF;
END $$;

UPDATE "ContractAllowance"
SET "metricKey" = COALESCE("metricKey", 'included-usage'),
    "valuationMethod" = CASE
        WHEN "valuationMethod" = 'commitment_first' THEN 'prorated_commitment'
        ELSE "valuationMethod"
    END;

ALTER TABLE "ContractUsageSnapshot"
    ADD COLUMN IF NOT EXISTS "contractAllowanceId" TEXT,
    ADD COLUMN IF NOT EXISTS "estimatedUnusedValue" DECIMAL(12,2),
    ADD COLUMN IF NOT EXISTS "projectedPeriodEndQuantity" DECIMAL(18,4),
    ADD COLUMN IF NOT EXISTS "projectedPeriodEndUtilizationPct" DECIMAL(5,2),
    ADD COLUMN IF NOT EXISTS "projectedOverageQuantity" DECIMAL(18,4),
    ADD COLUMN IF NOT EXISTS "dataSource" "UsageSnapshotDataSource",
    ADD COLUMN IF NOT EXISTS "dataConfidence" "UsageSnapshotDataConfidence";

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ContractUsageSnapshot'
          AND column_name = 'projectedUnusedValue'
    ) THEN
        EXECUTE 'UPDATE "ContractUsageSnapshot"
                 SET "estimatedUnusedValue" = COALESCE("estimatedUnusedValue", "projectedUnusedValue")
                 WHERE "projectedUnusedValue" IS NOT NULL';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ContractUsageSnapshot'
          AND column_name = 'projectedMonthEndQuantity'
    ) THEN
        EXECUTE 'UPDATE "ContractUsageSnapshot"
                 SET "projectedPeriodEndQuantity" = COALESCE("projectedPeriodEndQuantity", "projectedMonthEndQuantity")
                 WHERE "projectedMonthEndQuantity" IS NOT NULL';
    END IF;
END $$;

UPDATE "ContractUsageSnapshot"
SET "projectedPeriodEndUtilizationPct" = COALESCE("projectedPeriodEndUtilizationPct", "utilizationPct"),
    "projectedOverageQuantity" = COALESCE("projectedOverageQuantity", 0),
    "dataSource" = COALESCE("dataSource", CASE
        WHEN "sourceType" = 'internal_observed' THEN 'internal_usage'::"UsageSnapshotDataSource"
        WHEN "sourceType" = 'provider_api' THEN 'provider_api'::"UsageSnapshotDataSource"
        WHEN "sourceType" = 'manual' THEN 'manual'::"UsageSnapshotDataSource"
        ELSE 'manual'::"UsageSnapshotDataSource"
    END),
    "dataConfidence" = COALESCE("dataConfidence", CASE
        WHEN "confidence" = 'high' THEN 'high'::"UsageSnapshotDataConfidence"
        WHEN "confidence" = 'medium' THEN 'medium'::"UsageSnapshotDataConfidence"
        WHEN "confidence" = 'low' THEN 'low'::"UsageSnapshotDataConfidence"
        ELSE 'medium'::"UsageSnapshotDataConfidence"
    END);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ContractUsageSnapshot'
          AND column_name = 'contractId'
    ) THEN
        EXECUTE '
            WITH first_allowance AS (
                SELECT DISTINCT ON ("supplierContractId") id, "supplierContractId"
                FROM "ContractAllowance"
                WHERE "supplierContractId" IS NOT NULL
                ORDER BY "supplierContractId", "createdAt" ASC, id ASC
            )
            UPDATE "ContractUsageSnapshot" snapshot
            SET "contractAllowanceId" = COALESCE(snapshot."contractAllowanceId", allowance.id)
            FROM first_allowance allowance
            WHERE snapshot."contractId" = allowance."supplierContractId"
              AND snapshot."contractAllowanceId" IS NULL
        ';
    END IF;
END $$;

ALTER TABLE "FinanceWorkItem"
    ADD COLUMN IF NOT EXISTS "providerFinanceProfileId" TEXT,
    ADD COLUMN IF NOT EXISTS "supplierContractId" TEXT,
    ADD COLUMN IF NOT EXISTS "assignedEmployeeId" TEXT,
    ADD COLUMN IF NOT EXISTS "body" TEXT,
    ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'FinanceWorkItem'
          AND column_name = 'profileId'
    ) THEN
        EXECUTE 'UPDATE "FinanceWorkItem"
                 SET "providerFinanceProfileId" = COALESCE("providerFinanceProfileId", "profileId")
                 WHERE "profileId" IS NOT NULL';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'FinanceWorkItem'
          AND column_name = 'contractId'
    ) THEN
        EXECUTE 'UPDATE "FinanceWorkItem"
                 SET "supplierContractId" = COALESCE("supplierContractId", "contractId")
                 WHERE "contractId" IS NOT NULL';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'FinanceWorkItem'
          AND column_name = 'ownerEmployeeId'
    ) THEN
        EXECUTE 'UPDATE "FinanceWorkItem"
                 SET "assignedEmployeeId" = COALESCE("assignedEmployeeId", "ownerEmployeeId")
                 WHERE "ownerEmployeeId" IS NOT NULL';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'FinanceWorkItem'
          AND column_name = 'description'
    ) THEN
        EXECUTE 'UPDATE "FinanceWorkItem"
                 SET "body" = COALESCE("body", NULLIF("description", ''''))
                 WHERE "description" IS NOT NULL';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'FinanceWorkItem'
          AND column_name = 'dueAt'
    ) THEN
        EXECUTE 'UPDATE "FinanceWorkItem"
                 SET "dueDate" = COALESCE("dueDate", "dueAt")
                 WHERE "dueAt" IS NOT NULL';
    END IF;
END $$;

UPDATE "FinanceWorkItem"
SET "body" = COALESCE("body", "title");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MarketingStrategy_organizationId_key" ON "MarketingStrategy"("organizationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketingStrategy_status_idx" ON "MarketingStrategy"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketingStrategy_storefrontId_idx" ON "MarketingStrategy"("storefrontId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketingStrategy_nextReviewAt_idx" ON "MarketingStrategy"("nextReviewAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketingReview_organizationId_createdAt_idx" ON "MarketingReview"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketingReview_strategyId_createdAt_idx" ON "MarketingReview"("strategyId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketingReview_reviewType_idx" ON "MarketingReview"("reviewType");

CREATE UNIQUE INDEX IF NOT EXISTS "AiProviderFinanceProfile_providerId_key" ON "AiProviderFinanceProfile"("providerId");

CREATE INDEX IF NOT EXISTS "AiProviderFinanceProfile_supplierId_idx" ON "AiProviderFinanceProfile"("supplierId");

CREATE INDEX IF NOT EXISTS "AiProviderFinanceProfile_status_idx" ON "AiProviderFinanceProfile"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierContract_contractId_key" ON "SupplierContract"("contractId");

CREATE INDEX IF NOT EXISTS "SupplierContract_supplierId_idx" ON "SupplierContract"("supplierId");

CREATE INDEX IF NOT EXISTS "SupplierContract_providerFinanceProfileId_idx" ON "SupplierContract"("providerFinanceProfileId");

CREATE INDEX IF NOT EXISTS "SupplierContract_status_idx" ON "SupplierContract"("status");

CREATE INDEX IF NOT EXISTS "SupplierContract_budgetOwnerEmployeeId_idx" ON "SupplierContract"("budgetOwnerEmployeeId");

CREATE INDEX IF NOT EXISTS "ContractAllowance_supplierContractId_idx" ON "ContractAllowance"("supplierContractId");

CREATE INDEX IF NOT EXISTS "ContractAllowance_metricKey_idx" ON "ContractAllowance"("metricKey");

CREATE INDEX IF NOT EXISTS "ContractUsageSnapshot_snapshotDate_idx" ON "ContractUsageSnapshot"("snapshotDate");

CREATE UNIQUE INDEX IF NOT EXISTS "ContractUsageSnapshot_contractAllowanceId_snapshotDate_key" ON "ContractUsageSnapshot"("contractAllowanceId", "snapshotDate");

CREATE UNIQUE INDEX IF NOT EXISTS "FinanceWorkItem_workItemId_key" ON "FinanceWorkItem"("workItemId");

CREATE INDEX IF NOT EXISTS "FinanceWorkItem_providerFinanceProfileId_idx" ON "FinanceWorkItem"("providerFinanceProfileId");

CREATE INDEX IF NOT EXISTS "FinanceWorkItem_supplierContractId_idx" ON "FinanceWorkItem"("supplierContractId");

CREATE INDEX IF NOT EXISTS "FinanceWorkItem_assignedEmployeeId_idx" ON "FinanceWorkItem"("assignedEmployeeId");

CREATE INDEX IF NOT EXISTS "FinanceWorkItem_status_idx" ON "FinanceWorkItem"("status");

CREATE INDEX IF NOT EXISTS "FinanceWorkItem_type_idx" ON "FinanceWorkItem"("type");

-- AddForeignKey
DO $$
BEGIN
    ALTER TABLE "MarketingStrategy" ADD CONSTRAINT "MarketingStrategy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$
BEGIN
    ALTER TABLE "MarketingStrategy" ADD CONSTRAINT "MarketingStrategy_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "StorefrontConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$
BEGIN
    ALTER TABLE "MarketingReview" ADD CONSTRAINT "MarketingReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$
BEGIN
    ALTER TABLE "MarketingReview" ADD CONSTRAINT "MarketingReview_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "MarketingStrategy"("strategyId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "AiProviderFinanceProfile" ADD CONSTRAINT "AiProviderFinanceProfile_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ModelProvider"("providerId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "AiProviderFinanceProfile" ADD CONSTRAINT "AiProviderFinanceProfile_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "SupplierContract" ADD CONSTRAINT "SupplierContract_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "SupplierContract" ADD CONSTRAINT "SupplierContract_providerFinanceProfileId_fkey" FOREIGN KEY ("providerFinanceProfileId") REFERENCES "AiProviderFinanceProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "SupplierContract" ADD CONSTRAINT "SupplierContract_budgetOwnerEmployeeId_fkey" FOREIGN KEY ("budgetOwnerEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "ContractAllowance" ADD CONSTRAINT "ContractAllowance_supplierContractId_fkey" FOREIGN KEY ("supplierContractId") REFERENCES "SupplierContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "ContractUsageSnapshot" ADD CONSTRAINT "ContractUsageSnapshot_contractAllowanceId_fkey" FOREIGN KEY ("contractAllowanceId") REFERENCES "ContractAllowance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "FinanceWorkItem" ADD CONSTRAINT "FinanceWorkItem_providerFinanceProfileId_fkey" FOREIGN KEY ("providerFinanceProfileId") REFERENCES "AiProviderFinanceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "FinanceWorkItem" ADD CONSTRAINT "FinanceWorkItem_supplierContractId_fkey" FOREIGN KEY ("supplierContractId") REFERENCES "SupplierContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "FinanceWorkItem" ADD CONSTRAINT "FinanceWorkItem_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
