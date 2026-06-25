-- CreateTable
CREATE TABLE "DetectionRule" (
    "id" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "rulePackKey" TEXT NOT NULL,
    "rulePackVersion" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ruleFormat" TEXT NOT NULL,
    "predicate" JSONB NOT NULL,
    "mitreTechniques" JSONB NOT NULL DEFAULT '[]',
    "severity" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "tuning" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DetectionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Detection" (
    "id" TEXT NOT NULL,
    "detectionKey" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "customerSiteId" TEXT,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "riskScore" INTEGER,
    "matchedEventRefs" JSONB NOT NULL DEFAULT '[]',
    "enrichment" JSONB NOT NULL DEFAULT '{}',
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "securityCaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Detection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreatIndicator" (
    "id" TEXT NOT NULL,
    "indicatorKey" TEXT NOT NULL,
    "indicatorType" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "severity" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "tags" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreatIndicator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DetectionRule_ruleKey_key" ON "DetectionRule"("ruleKey");

-- CreateIndex
CREATE INDEX "DetectionRule_scopeKey_enabled_idx" ON "DetectionRule"("scopeKey", "enabled");

-- CreateIndex
CREATE INDEX "DetectionRule_rulePackKey_rulePackVersion_idx" ON "DetectionRule"("rulePackKey", "rulePackVersion");

-- CreateIndex
CREATE UNIQUE INDEX "Detection_detectionKey_key" ON "Detection"("detectionKey");

-- CreateIndex
CREATE INDEX "Detection_scopeKey_status_lastSeenAt_idx" ON "Detection"("scopeKey", "status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Detection_customerAccountId_severity_status_idx" ON "Detection"("customerAccountId", "severity", "status");

-- CreateIndex
CREATE INDEX "Detection_ruleId_lastSeenAt_idx" ON "Detection"("ruleId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Detection_createdAt_idx" ON "Detection"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ThreatIndicator_indicatorKey_key" ON "ThreatIndicator"("indicatorKey");

-- CreateIndex
CREATE INDEX "ThreatIndicator_value_idx" ON "ThreatIndicator"("value");

-- CreateIndex
CREATE INDEX "ThreatIndicator_indicatorType_value_idx" ON "ThreatIndicator"("indicatorType", "value");

-- CreateIndex
CREATE INDEX "ThreatIndicator_source_idx" ON "ThreatIndicator"("source");

-- CreateIndex
CREATE INDEX "ThreatIndicator_validUntil_idx" ON "ThreatIndicator"("validUntil");
