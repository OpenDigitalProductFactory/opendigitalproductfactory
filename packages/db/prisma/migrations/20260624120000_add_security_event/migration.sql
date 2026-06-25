-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "ocsfVersion" TEXT NOT NULL,
    "ocsfCategoryUid" INTEGER,
    "ocsfClassUid" INTEGER NOT NULL,
    "ocsfActivityId" INTEGER,
    "severityId" INTEGER,
    "time" TIMESTAMP(3) NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "customerSiteId" TEXT,
    "edgeNodeId" TEXT,
    "sourceKind" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "actorPrincipalId" TEXT,
    "actor" JSONB NOT NULL DEFAULT '{}',
    "device" JSONB NOT NULL DEFAULT '{}',
    "srcEndpoint" JSONB NOT NULL DEFAULT '{}',
    "dstEndpoint" JSONB NOT NULL DEFAULT '{}',
    "observables" JSONB NOT NULL DEFAULT '[]',
    "normalized" JSONB NOT NULL DEFAULT '{}',
    "rawRef" JSONB NOT NULL DEFAULT '{}',
    "confidence" TEXT NOT NULL DEFAULT 'source-reported',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecurityEvent_eventKey_key" ON "SecurityEvent"("eventKey");

-- CreateIndex
CREATE INDEX "SecurityEvent_scopeKey_time_idx" ON "SecurityEvent"("scopeKey", "time");

-- CreateIndex
CREATE INDEX "SecurityEvent_customerAccountId_severityId_time_idx" ON "SecurityEvent"("customerAccountId", "severityId", "time");

-- CreateIndex
CREATE INDEX "SecurityEvent_edgeNodeId_time_idx" ON "SecurityEvent"("edgeNodeId", "time");

-- CreateIndex
CREATE INDEX "SecurityEvent_ocsfClassUid_time_idx" ON "SecurityEvent"("ocsfClassUid", "time");

-- CreateIndex
CREATE INDEX "SecurityEvent_createdAt_idx" ON "SecurityEvent"("createdAt");
