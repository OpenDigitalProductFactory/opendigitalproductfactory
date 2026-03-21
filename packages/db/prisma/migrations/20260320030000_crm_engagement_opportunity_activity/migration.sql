-- CRM Phase 2: Engagement, Opportunity, and Activity models
-- EP-CRM-SALES-001 P1-P5: Sales pipeline foundation

-- CreateTable
CREATE TABLE "Engagement" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "source" TEXT,
    "sourceRefId" TEXT,
    "accountId" TEXT,
    "contactId" TEXT NOT NULL,
    "assignedToId" TEXT,
    "notes" TEXT,
    "convertedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'qualification',
    "isDormant" BOOLEAN NOT NULL DEFAULT false,
    "probability" INTEGER NOT NULL DEFAULT 10,
    "expectedValue" DECIMAL(65,30),
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "expectedClose" TIMESTAMP(3),
    "actualClose" TIMESTAMP(3),
    "lostReason" TEXT,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT,
    "assignedToId" TEXT,
    "engagementId" TEXT,
    "notes" TEXT,
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "accountId" TEXT,
    "contactId" TEXT,
    "opportunityId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- Indexes: Engagement
CREATE UNIQUE INDEX "Engagement_engagementId_key" ON "Engagement"("engagementId");
CREATE INDEX "Engagement_status_idx" ON "Engagement"("status");
CREATE INDEX "Engagement_accountId_idx" ON "Engagement"("accountId");
CREATE INDEX "Engagement_contactId_idx" ON "Engagement"("contactId");
CREATE INDEX "Engagement_assignedToId_idx" ON "Engagement"("assignedToId");

-- Indexes: Opportunity
CREATE UNIQUE INDEX "Opportunity_opportunityId_key" ON "Opportunity"("opportunityId");
CREATE INDEX "Opportunity_stage_idx" ON "Opportunity"("stage");
CREATE INDEX "Opportunity_accountId_idx" ON "Opportunity"("accountId");
CREATE INDEX "Opportunity_contactId_idx" ON "Opportunity"("contactId");
CREATE INDEX "Opportunity_assignedToId_idx" ON "Opportunity"("assignedToId");
CREATE INDEX "Opportunity_expectedClose_idx" ON "Opportunity"("expectedClose");
CREATE INDEX "Opportunity_isDormant_idx" ON "Opportunity"("isDormant");

-- Indexes: Activity
CREATE UNIQUE INDEX "Activity_activityId_key" ON "Activity"("activityId");
CREATE INDEX "Activity_accountId_idx" ON "Activity"("accountId");
CREATE INDEX "Activity_contactId_idx" ON "Activity"("contactId");
CREATE INDEX "Activity_opportunityId_idx" ON "Activity"("opportunityId");
CREATE INDEX "Activity_createdAt_idx" ON "Activity"("createdAt");
CREATE INDEX "Activity_type_idx" ON "Activity"("type");

-- Foreign Keys: Engagement
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CustomerContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign Keys: Opportunity
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CustomerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign Keys: Activity
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CustomerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
