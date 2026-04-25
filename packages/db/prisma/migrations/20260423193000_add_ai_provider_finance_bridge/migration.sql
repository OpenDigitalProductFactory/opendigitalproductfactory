-- CreateTable
CREATE TABLE "AiProviderFinanceProfile" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "supplierId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'seeded',
    "reconciliationStrategy" TEXT NOT NULL DEFAULT 'provider_portal',
    "valuationMethod" TEXT NOT NULL DEFAULT 'commitment_first',
    "planCurrency" TEXT NOT NULL DEFAULT 'USD',
    "monthlyBudget" DECIMAL(65,30),
    "billingUrl" TEXT,
    "usageUrl" TEXT,
    "notes" TEXT,
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastSnapshotAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderFinanceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierContract" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "accountableEmployeeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "contractType" TEXT NOT NULL DEFAULT 'subscription',
    "billingCadence" TEXT NOT NULL DEFAULT 'monthly',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "monthlyCommittedAmount" DECIMAL(65,30),
    "budgetAmount" DECIMAL(65,30),
    "budgetWindow" TEXT NOT NULL DEFAULT 'monthly',
    "allowsOverage" BOOLEAN NOT NULL DEFAULT false,
    "usageUnit" TEXT,
    "billingUrl" TEXT,
    "usageUrl" TEXT,
    "renewalDate" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractAllowance" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "allowanceName" TEXT NOT NULL,
    "usageUnit" TEXT NOT NULL,
    "includedQuantity" DECIMAL(65,30) NOT NULL,
    "overageUnitCost" DECIMAL(65,30),
    "valuationMethod" TEXT NOT NULL DEFAULT 'commitment_first',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractAllowance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractUsageSnapshot" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'internal_observed',
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "consumedQuantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "includedQuantity" DECIMAL(65,30),
    "remainingQuantity" DECIMAL(65,30),
    "utilizationPct" DOUBLE PRECISION,
    "projectedMonthEndQuantity" DECIMAL(65,30),
    "projectedUnusedValue" DECIMAL(65,30),
    "projectedOverageCost" DECIMAL(65,30),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractUsageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceWorkItem" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "profileId" TEXT,
    "contractId" TEXT,
    "supplierId" TEXT,
    "ownerEmployeeId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceWorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiProviderFinanceProfile_providerId_key" ON "AiProviderFinanceProfile"("providerId");
CREATE INDEX "AiProviderFinanceProfile_supplierId_idx" ON "AiProviderFinanceProfile"("supplierId");
CREATE INDEX "AiProviderFinanceProfile_status_idx" ON "AiProviderFinanceProfile"("status");

CREATE UNIQUE INDEX "SupplierContract_contractId_key" ON "SupplierContract"("contractId");
CREATE INDEX "SupplierContract_profileId_idx" ON "SupplierContract"("profileId");
CREATE INDEX "SupplierContract_supplierId_idx" ON "SupplierContract"("supplierId");
CREATE INDEX "SupplierContract_status_idx" ON "SupplierContract"("status");
CREATE INDEX "SupplierContract_accountableEmployeeId_idx" ON "SupplierContract"("accountableEmployeeId");

CREATE INDEX "ContractAllowance_contractId_idx" ON "ContractAllowance"("contractId");

CREATE UNIQUE INDEX "ContractUsageSnapshot_contractId_snapshotDate_key" ON "ContractUsageSnapshot"("contractId", "snapshotDate");
CREATE INDEX "ContractUsageSnapshot_snapshotDate_idx" ON "ContractUsageSnapshot"("snapshotDate");

CREATE UNIQUE INDEX "FinanceWorkItem_workItemId_key" ON "FinanceWorkItem"("workItemId");
CREATE INDEX "FinanceWorkItem_profileId_idx" ON "FinanceWorkItem"("profileId");
CREATE INDEX "FinanceWorkItem_contractId_idx" ON "FinanceWorkItem"("contractId");
CREATE INDEX "FinanceWorkItem_supplierId_idx" ON "FinanceWorkItem"("supplierId");
CREATE INDEX "FinanceWorkItem_ownerEmployeeId_idx" ON "FinanceWorkItem"("ownerEmployeeId");
CREATE INDEX "FinanceWorkItem_status_severity_idx" ON "FinanceWorkItem"("status", "severity");

-- AddForeignKey
ALTER TABLE "AiProviderFinanceProfile"
ADD CONSTRAINT "AiProviderFinanceProfile_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "ModelProvider"("providerId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiProviderFinanceProfile"
ADD CONSTRAINT "AiProviderFinanceProfile_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplierContract"
ADD CONSTRAINT "SupplierContract_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "AiProviderFinanceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierContract"
ADD CONSTRAINT "SupplierContract_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierContract"
ADD CONSTRAINT "SupplierContract_accountableEmployeeId_fkey"
FOREIGN KEY ("accountableEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContractAllowance"
ADD CONSTRAINT "ContractAllowance_contractId_fkey"
FOREIGN KEY ("contractId") REFERENCES "SupplierContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContractUsageSnapshot"
ADD CONSTRAINT "ContractUsageSnapshot_contractId_fkey"
FOREIGN KEY ("contractId") REFERENCES "SupplierContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FinanceWorkItem"
ADD CONSTRAINT "FinanceWorkItem_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "AiProviderFinanceProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinanceWorkItem"
ADD CONSTRAINT "FinanceWorkItem_contractId_fkey"
FOREIGN KEY ("contractId") REFERENCES "SupplierContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinanceWorkItem"
ADD CONSTRAINT "FinanceWorkItem_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinanceWorkItem"
ADD CONSTRAINT "FinanceWorkItem_ownerEmployeeId_fkey"
FOREIGN KEY ("ownerEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
