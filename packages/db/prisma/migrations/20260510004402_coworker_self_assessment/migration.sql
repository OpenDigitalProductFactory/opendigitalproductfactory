-- CreateTable
CREATE TABLE "CoworkerSelfAssessment" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "routeContext" TEXT,
    "verdict" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "missionSummary" TEXT,
    "capabilitySummary" TEXT,
    "rawPayload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "CoworkerSelfAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoworkerCapabilityNeed" (
    "id" TEXT NOT NULL,
    "needId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "need" TEXT NOT NULL,
    "blocks" TEXT NOT NULL,
    "evidenceJson" JSONB NOT NULL DEFAULT '{}',
    "readinessJson" JSONB NOT NULL DEFAULT '{}',
    "linkedBacklogItemId" TEXT,
    "duplicateOfId" TEXT,
    "reviewerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoworkerCapabilityNeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoworkerSelfAssessment_assessmentId_key" ON "CoworkerSelfAssessment"("assessmentId");

-- CreateIndex
CREATE INDEX "CoworkerSelfAssessment_agentId_createdAt_idx" ON "CoworkerSelfAssessment"("agentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CoworkerSelfAssessment_verdict_createdAt_idx" ON "CoworkerSelfAssessment"("verdict", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CoworkerSelfAssessment_trigger_createdAt_idx" ON "CoworkerSelfAssessment"("trigger", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CoworkerCapabilityNeed_needId_key" ON "CoworkerCapabilityNeed"("needId");

-- CreateIndex
CREATE INDEX "CoworkerCapabilityNeed_agentId_status_idx" ON "CoworkerCapabilityNeed"("agentId", "status");

-- CreateIndex
CREATE INDEX "CoworkerCapabilityNeed_status_severity_idx" ON "CoworkerCapabilityNeed"("status", "severity");

-- CreateIndex
CREATE INDEX "CoworkerCapabilityNeed_kind_status_idx" ON "CoworkerCapabilityNeed"("kind", "status");

-- CreateIndex
CREATE INDEX "CoworkerCapabilityNeed_linkedBacklogItemId_idx" ON "CoworkerCapabilityNeed"("linkedBacklogItemId");

-- CreateIndex
CREATE INDEX "CoworkerCapabilityNeed_assessmentId_idx" ON "CoworkerCapabilityNeed"("assessmentId");

-- AddForeignKey
ALTER TABLE "CoworkerSelfAssessment" ADD CONSTRAINT "CoworkerSelfAssessment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoworkerCapabilityNeed" ADD CONSTRAINT "CoworkerCapabilityNeed_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "CoworkerSelfAssessment"("assessmentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoworkerCapabilityNeed" ADD CONSTRAINT "CoworkerCapabilityNeed_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("agentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoworkerCapabilityNeed" ADD CONSTRAINT "CoworkerCapabilityNeed_linkedBacklogItemId_fkey" FOREIGN KEY ("linkedBacklogItemId") REFERENCES "BacklogItem"("itemId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoworkerCapabilityNeed" ADD CONSTRAINT "CoworkerCapabilityNeed_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "CoworkerCapabilityNeed"("needId") ON DELETE SET NULL ON UPDATE CASCADE;
