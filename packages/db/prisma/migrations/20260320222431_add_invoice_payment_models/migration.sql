/*
  Warnings:

  - You are about to drop the column `companyName` on the `BrandingConfig` table. All the data in the column will be lost.
  - You are about to drop the column `logoUrl` on the `BrandingConfig` table. All the data in the column will be lost.
  - You are about to drop the column `searchVector` on the `CustomerAccount` table. All the data in the column will be lost.
  - You are about to drop the column `searchVector` on the `CustomerContact` table. All the data in the column will be lost.
  - You are about to drop the `DiscoveredSoftwareEvidence` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SoftwareIdentity` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SoftwareNormalizationRule` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "DiscoveredSoftwareEvidence" DROP CONSTRAINT "DiscoveredSoftwareEvidence_inventoryEntityId_fkey";

-- DropForeignKey
ALTER TABLE "DiscoveredSoftwareEvidence" DROP CONSTRAINT "DiscoveredSoftwareEvidence_softwareIdentityId_fkey";

-- DropForeignKey
ALTER TABLE "SoftwareNormalizationRule" DROP CONSTRAINT "SoftwareNormalizationRule_softwareIdentityId_fkey";

-- DropIndex
DROP INDEX "CustomerAccount_searchVector_idx";

-- DropIndex
DROP INDEX "CustomerContact_searchVector_idx";

-- AlterTable
ALTER TABLE "AgentActionProposal" ADD COLUMN     "gitCommitHash" TEXT;

-- AlterTable
ALTER TABLE "BrandingConfig" DROP COLUMN "companyName",
DROP COLUMN "logoUrl",
ADD COLUMN     "label" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "complianceEntityId" TEXT,
ADD COLUMN     "complianceEntityType" TEXT;

-- AlterTable
ALTER TABLE "CustomerAccount" DROP COLUMN "searchVector";

-- AlterTable
ALTER TABLE "CustomerContact" DROP COLUMN "searchVector";

-- AlterTable
ALTER TABLE "DiscoveredModel" ADD COLUMN     "missedDiscoveryCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "EndpointTaskPerformance" ADD COLUMN     "modelId" TEXT;

-- AlterTable
ALTER TABLE "ModelProfile" ADD COLUMN     "codegen" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "contextRetention" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "conversational" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "customScores" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "evalCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "inputPricePerMToken" DOUBLE PRECISION,
ADD COLUMN     "instructionFollowingScore" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "lastEvalAt" TIMESTAMP(3),
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "maxContextTokens" INTEGER,
ADD COLUMN     "maxOutputTokens" INTEGER,
ADD COLUMN     "modelStatus" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "outputPricePerMToken" DOUBLE PRECISION,
ADD COLUMN     "profileConfidence" TEXT NOT NULL DEFAULT 'low',
ADD COLUMN     "profileSource" TEXT NOT NULL DEFAULT 'seed',
ADD COLUMN     "reasoning" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "retiredReason" TEXT,
ADD COLUMN     "structuredOutputScore" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "supportedModalities" JSONB NOT NULL DEFAULT '{"input": ["text"], "output": ["text"]}',
ADD COLUMN     "toolFidelity" INTEGER NOT NULL DEFAULT 50;

-- AlterTable
ALTER TABLE "RouteDecisionLog" ADD COLUMN     "selectedModelId" TEXT;

-- AlterTable
ALTER TABLE "ServiceOffering" ADD COLUMN     "effectiveFrom" TIMESTAMP(3),
ADD COLUMN     "effectiveTo" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TaskEvaluation" ADD COLUMN     "source" TEXT;

-- DropTable
DROP TABLE "DiscoveredSoftwareEvidence";

-- DropTable
DROP TABLE "SoftwareIdentity";

-- DropTable
DROP TABLE "SoftwareNormalizationRule";

-- CreateTable
CREATE TABLE "EndpointTestRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "endpointId" TEXT,
    "taskType" TEXT,
    "probesOnly" BOOLEAN NOT NULL DEFAULT false,
    "triggeredBy" TEXT NOT NULL,
    "probesPassed" INTEGER NOT NULL DEFAULT 0,
    "probesFailed" INTEGER NOT NULL DEFAULT 0,
    "scenariosPassed" INTEGER NOT NULL DEFAULT 0,
    "scenariosFailed" INTEGER NOT NULL DEFAULT 0,
    "avgScore" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "results" JSONB,
    "modelId" TEXT,

    CONSTRAINT "EndpointTestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpIntegration" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortDescription" TEXT,
    "description" TEXT,
    "logoUrl" TEXT,
    "vendor" TEXT,
    "repositoryUrl" TEXT,
    "documentationUrl" TEXT,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pricingModel" TEXT,
    "rating" DECIMAL(65,30),
    "ratingCount" INTEGER,
    "installCount" INTEGER,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "archetypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "rawMetadata" JSONB NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpCatalogSync" (
    "id" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "triggeredByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "totalFetched" INTEGER,
    "totalUpserted" INTEGER,
    "totalNew" INTEGER,
    "totalRemoved" INTEGER,
    "error" TEXT,

    CONSTRAINT "McpCatalogSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceRef" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'standard',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "accountId" TEXT NOT NULL,
    "contactId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "subtotal" DECIMAL(65,30) NOT NULL,
    "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "amountPaid" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "amountDue" DECIMAL(65,30) NOT NULL,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "internalNotes" TEXT,
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "erpSyncStatus" TEXT DEFAULT 'pending',
    "erpRefId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "taxRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(65,30) NOT NULL,
    "accountCode" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "paymentRef" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "exchangeRate" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "baseCurrencyAmount" DECIMAL(65,30),
    "reference" TEXT,
    "stripePaymentId" TEXT,
    "counterpartyId" TEXT,
    "counterpartyType" TEXT,
    "receivedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" TIMESTAMP(3),
    "erpSyncStatus" TEXT DEFAULT 'pending',
    "erpRefId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EndpointTestRun_runId_key" ON "EndpointTestRun"("runId");

-- CreateIndex
CREATE INDEX "EndpointTestRun_endpointId_idx" ON "EndpointTestRun"("endpointId");

-- CreateIndex
CREATE INDEX "EndpointTestRun_status_idx" ON "EndpointTestRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "McpIntegration_registryId_key" ON "McpIntegration"("registryId");

-- CreateIndex
CREATE UNIQUE INDEX "McpIntegration_slug_key" ON "McpIntegration"("slug");

-- CreateIndex
CREATE INDEX "McpIntegration_category_idx" ON "McpIntegration"("category");

-- CreateIndex
CREATE INDEX "McpIntegration_pricingModel_idx" ON "McpIntegration"("pricingModel");

-- CreateIndex
CREATE INDEX "McpIntegration_isVerified_idx" ON "McpIntegration"("isVerified");

-- CreateIndex
CREATE INDEX "McpIntegration_status_idx" ON "McpIntegration"("status");

-- CreateIndex
CREATE INDEX "McpIntegration_tags_idx" ON "McpIntegration"("tags");

-- CreateIndex
CREATE INDEX "McpCatalogSync_startedAt_idx" ON "McpCatalogSync"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceRef_key" ON "Invoice"("invoiceRef");

-- CreateIndex
CREATE INDEX "Invoice_accountId_idx" ON "Invoice"("accountId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE INDEX "Invoice_sourceType_sourceId_idx" ON "Invoice"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentRef_key" ON "Payment"("paymentRef");

-- CreateIndex
CREATE INDEX "Payment_direction_idx" ON "Payment"("direction");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_counterpartyId_counterpartyType_idx" ON "Payment"("counterpartyId", "counterpartyType");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoiceId_idx" ON "PaymentAllocation"("invoiceId");

-- CreateIndex
CREATE INDEX "CalendarEvent_complianceEntityType_complianceEntityId_idx" ON "CalendarEvent"("complianceEntityType", "complianceEntityId");

-- CreateIndex
CREATE INDEX "ServiceOffering_digitalProductId_idx" ON "ServiceOffering"("digitalProductId");

-- CreateIndex
CREATE INDEX "ServiceOffering_status_idx" ON "ServiceOffering"("status");

-- AddForeignKey
ALTER TABLE "ModelProfile" ADD CONSTRAINT "ModelProfile_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ModelProvider"("providerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CustomerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
