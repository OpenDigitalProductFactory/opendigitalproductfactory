-- CreateTable
CREATE TABLE "SecurityCase" (
    "id" TEXT NOT NULL,
    "caseKey" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "customerSiteId" TEXT,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "verdict" TEXT NOT NULL DEFAULT 'unknown',
    "confidence" TEXT NOT NULL DEFAULT 'low',
    "assignedAgentId" TEXT,
    "assignedUserId" TEXT,
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "sla" JSONB NOT NULL DEFAULT '{}',
    "complianceIncidentId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "SecurityCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecurityCase_caseKey_key" ON "SecurityCase"("caseKey");

-- CreateIndex
CREATE INDEX "SecurityCase_scopeKey_status_openedAt_idx" ON "SecurityCase"("scopeKey", "status", "openedAt");

-- CreateIndex
CREATE INDEX "SecurityCase_customerAccountId_severity_status_idx" ON "SecurityCase"("customerAccountId", "severity", "status");

-- CreateIndex
CREATE INDEX "SecurityCase_complianceIncidentId_idx" ON "SecurityCase"("complianceIncidentId");
