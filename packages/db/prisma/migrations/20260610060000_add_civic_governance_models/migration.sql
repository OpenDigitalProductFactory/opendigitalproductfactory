-- BI-8D477188 Phase 2: civic & member-governed archetype models.
-- Additive tables only — no existing-table changes except BusinessContext.stateCode.
-- GovernanceMeeting serves both public-body (council/committee) and member-owned
-- (board/annual-meeting) governance via bodyType, so credit-union/cooperative
-- archetypes reuse the same workflow table.

ALTER TABLE "BusinessContext" ADD COLUMN "stateCode" TEXT;

CREATE TABLE "GovernanceMeeting" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bodyType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "agendaContent" TEXT,
    "agendaPublishedAt" TIMESTAMP(3),
    "minutesContent" TEXT,
    "minutesRecordedAt" TIMESTAMP(3),
    "minutesApprovedAt" TIMESTAMP(3),
    "attendees" JSONB,
    "decisions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GovernanceMeeting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GovernanceMeeting_meetingId_key" ON "GovernanceMeeting"("meetingId");
CREATE INDEX "GovernanceMeeting_organizationId_scheduledAt_idx" ON "GovernanceMeeting"("organizationId", "scheduledAt");
CREATE INDEX "GovernanceMeeting_organizationId_status_idx" ON "GovernanceMeeting"("organizationId", "status");

ALTER TABLE "GovernanceMeeting" ADD CONSTRAINT "GovernanceMeeting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RecordsRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "requesterEmail" TEXT,
    "requesterPhone" TEXT,
    "description" TEXT NOT NULL,
    "requestedRecords" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseDueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "responseSummary" TEXT,
    "denialReason" TEXT,
    "exemptionsCited" JSONB,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordsRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecordsRequest_requestId_key" ON "RecordsRequest"("requestId");
CREATE INDEX "RecordsRequest_organizationId_status_idx" ON "RecordsRequest"("organizationId", "status");
CREATE INDEX "RecordsRequest_organizationId_responseDueAt_idx" ON "RecordsRequest"("organizationId", "responseDueAt");

ALTER TABLE "RecordsRequest" ADD CONSTRAINT "RecordsRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FundBudgetLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "fund" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "budgetedAmount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundBudgetLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FundBudgetLine_organizationId_fiscalYear_fund_accountCode_key" ON "FundBudgetLine"("organizationId", "fiscalYear", "fund", "accountCode");
CREATE INDEX "FundBudgetLine_organizationId_fiscalYear_idx" ON "FundBudgetLine"("organizationId", "fiscalYear");

ALTER TABLE "FundBudgetLine" ADD CONSTRAINT "FundBudgetLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
