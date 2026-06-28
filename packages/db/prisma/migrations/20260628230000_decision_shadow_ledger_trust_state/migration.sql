-- CreateTable
CREATE TABLE "DecisionShadowLedger" (
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "riskClass" TEXT NOT NULL,
    "autonomyLevel" TEXT NOT NULL DEFAULT 'shadow',
    "proposedDecision" JSONB NOT NULL,
    "rationale" TEXT,
    "actualDecision" JSONB,
    "outcome" JSONB,
    "agreement" BOOLEAN,
    "sourceKind" TEXT,
    "taskRunId" TEXT,
    "toolExecutionId" TEXT,
    "decisionInteractionId" TEXT,
    "envelopeId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionShadowLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustState" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "riskClass" TEXT NOT NULL,
    "currentLevel" TEXT NOT NULL DEFAULT 'shadow',
    "regulatoryCeiling" TEXT,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "agreementCount" INTEGER NOT NULL DEFAULT 0,
    "agreementRate" DOUBLE PRECISION,
    "lastLedgerId" TEXT,
    "recommendation" JSONB NOT NULL DEFAULT '{}',
    "lastEvaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DecisionShadowLedger_ledgerId_key" ON "DecisionShadowLedger"("ledgerId");

-- CreateIndex
CREATE INDEX "DecisionShadowLedger_agentId_activityType_riskClass_observedAt_idx" ON "DecisionShadowLedger"("agentId", "activityType", "riskClass", "observedAt" DESC);

-- CreateIndex
CREATE INDEX "DecisionShadowLedger_agentId_observedAt_idx" ON "DecisionShadowLedger"("agentId", "observedAt" DESC);

-- CreateIndex
CREATE INDEX "DecisionShadowLedger_activityType_riskClass_idx" ON "DecisionShadowLedger"("activityType", "riskClass");

-- CreateIndex
CREATE INDEX "DecisionShadowLedger_agreement_idx" ON "DecisionShadowLedger"("agreement");

-- CreateIndex
CREATE INDEX "DecisionShadowLedger_taskRunId_idx" ON "DecisionShadowLedger"("taskRunId");

-- CreateIndex
CREATE INDEX "DecisionShadowLedger_toolExecutionId_idx" ON "DecisionShadowLedger"("toolExecutionId");

-- CreateIndex
CREATE INDEX "DecisionShadowLedger_decisionInteractionId_idx" ON "DecisionShadowLedger"("decisionInteractionId");

-- CreateIndex
CREATE INDEX "DecisionShadowLedger_envelopeId_idx" ON "DecisionShadowLedger"("envelopeId");

-- CreateIndex
CREATE INDEX "DecisionShadowLedger_observedAt_idx" ON "DecisionShadowLedger"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrustState_agentId_activityType_riskClass_key" ON "TrustState"("agentId", "activityType", "riskClass");

-- CreateIndex
CREATE INDEX "TrustState_agentId_currentLevel_idx" ON "TrustState"("agentId", "currentLevel");

-- CreateIndex
CREATE INDEX "TrustState_activityType_riskClass_idx" ON "TrustState"("activityType", "riskClass");

-- CreateIndex
CREATE INDEX "TrustState_currentLevel_idx" ON "TrustState"("currentLevel");

-- CreateIndex
CREATE INDEX "TrustState_regulatoryCeiling_idx" ON "TrustState"("regulatoryCeiling");

-- CreateIndex
CREATE INDEX "TrustState_lastEvaluatedAt_idx" ON "TrustState"("lastEvaluatedAt");
