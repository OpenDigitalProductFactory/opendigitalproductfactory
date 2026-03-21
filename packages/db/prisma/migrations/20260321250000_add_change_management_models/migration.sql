-- CreateTable
CREATE TABLE "ChangeRequest" (
    "id" TEXT NOT NULL,
    "rfcId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'normal',
    "scope" TEXT NOT NULL DEFAULT 'platform',
    "riskLevel" TEXT NOT NULL DEFAULT 'low',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMP(3),
    "assessedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "assessedById" TEXT,
    "approvedById" TEXT,
    "executedById" TEXT,
    "deploymentWindowId" TEXT,
    "plannedStartAt" TIMESTAMP(3),
    "plannedEndAt" TIMESTAMP(3),
    "calendarEventId" TEXT,
    "impactReport" JSONB,
    "outcome" TEXT,
    "outcomeNotes" TEXT,
    "postChangeVerification" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeItem" (
    "id" TEXT NOT NULL,
    "changeRequestId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "impactDescription" TEXT,
    "inventoryEntityId" TEXT,
    "digitalProductId" TEXT,
    "externalSystemRef" TEXT,
    "changePromotionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "executionOrder" INTEGER NOT NULL DEFAULT 0,
    "executionNotes" TEXT,
    "completedAt" TIMESTAMP(3),
    "rollbackPlan" TEXT,
    "rollbackSnapshot" JSONB,
    "rolledBackAt" TIMESTAMP(3),
    "rollbackNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessProfile" (
    "id" TEXT NOT NULL,
    "profileKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "businessHours" JSONB NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "hasStorefront" BOOLEAN NOT NULL DEFAULT false,
    "lowTrafficWindows" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentWindow" (
    "id" TEXT NOT NULL,
    "businessProfileId" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dayOfWeek" INTEGER[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "maxConcurrentChanges" INTEGER NOT NULL DEFAULT 1,
    "allowedChangeTypes" TEXT[] DEFAULT ARRAY['standard', 'normal']::TEXT[],
    "allowedRiskLevels" TEXT[] DEFAULT ARRAY['low', 'medium']::TEXT[],
    "enforcement" TEXT NOT NULL DEFAULT 'advisory',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlackoutPeriod" (
    "id" TEXT NOT NULL,
    "businessProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reason" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'all',
    "exceptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "calendarEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlackoutPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandardChangeCatalog" (
    "id" TEXT NOT NULL,
    "catalogKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "preAssessedRisk" TEXT NOT NULL,
    "templateItems" JSONB NOT NULL,
    "approvalPolicy" TEXT NOT NULL DEFAULT 'auto',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "approvedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandardChangeCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChangeRequest_rfcId_key" ON "ChangeRequest"("rfcId");

-- CreateIndex
CREATE INDEX "ChangeRequest_status_idx" ON "ChangeRequest"("status");

-- CreateIndex
CREATE INDEX "ChangeRequest_type_idx" ON "ChangeRequest"("type");

-- CreateIndex
CREATE INDEX "ChangeRequest_requestedById_idx" ON "ChangeRequest"("requestedById");

-- CreateIndex
CREATE INDEX "ChangeRequest_deploymentWindowId_idx" ON "ChangeRequest"("deploymentWindowId");

-- CreateIndex
CREATE INDEX "ChangeRequest_plannedStartAt_idx" ON "ChangeRequest"("plannedStartAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeItem_changePromotionId_key" ON "ChangeItem"("changePromotionId");

-- CreateIndex
CREATE INDEX "ChangeItem_changeRequestId_idx" ON "ChangeItem"("changeRequestId");

-- CreateIndex
CREATE INDEX "ChangeItem_inventoryEntityId_idx" ON "ChangeItem"("inventoryEntityId");

-- CreateIndex
CREATE INDEX "ChangeItem_digitalProductId_idx" ON "ChangeItem"("digitalProductId");

-- CreateIndex
CREATE INDEX "ChangeItem_status_idx" ON "ChangeItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessProfile_profileKey_key" ON "BusinessProfile"("profileKey");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentWindow_windowKey_key" ON "DeploymentWindow"("windowKey");

-- CreateIndex
CREATE INDEX "DeploymentWindow_businessProfileId_idx" ON "DeploymentWindow"("businessProfileId");

-- CreateIndex
CREATE INDEX "BlackoutPeriod_businessProfileId_idx" ON "BlackoutPeriod"("businessProfileId");

-- CreateIndex
CREATE INDEX "BlackoutPeriod_startAt_endAt_idx" ON "BlackoutPeriod"("startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "StandardChangeCatalog_catalogKey_key" ON "StandardChangeCatalog"("catalogKey");

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_deploymentWindowId_fkey" FOREIGN KEY ("deploymentWindowId") REFERENCES "DeploymentWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeItem" ADD CONSTRAINT "ChangeItem_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeItem" ADD CONSTRAINT "ChangeItem_inventoryEntityId_fkey" FOREIGN KEY ("inventoryEntityId") REFERENCES "InventoryEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeItem" ADD CONSTRAINT "ChangeItem_digitalProductId_fkey" FOREIGN KEY ("digitalProductId") REFERENCES "DigitalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeItem" ADD CONSTRAINT "ChangeItem_changePromotionId_fkey" FOREIGN KEY ("changePromotionId") REFERENCES "ChangePromotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentWindow" ADD CONSTRAINT "DeploymentWindow_businessProfileId_fkey" FOREIGN KEY ("businessProfileId") REFERENCES "BusinessProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlackoutPeriod" ADD CONSTRAINT "BlackoutPeriod_businessProfileId_fkey" FOREIGN KEY ("businessProfileId") REFERENCES "BusinessProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandardChangeCatalog" ADD CONSTRAINT "StandardChangeCatalog_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
