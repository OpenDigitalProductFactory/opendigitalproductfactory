-- @migration-safety: data-safe: additive journal tables contain no legacy rows;
-- required columns are populated only by new application writes and no backfill
-- can truthfully reconstruct historical intent, authorization, or target effects.

CREATE TABLE "DataControlOperation" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorRef" TEXT NOT NULL,
    "actorAuthority" JSONB NOT NULL,
    "actionKey" TEXT NOT NULL,
    "purposeOfUse" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "envelopeHash" TEXT NOT NULL,
    "assetRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "fieldRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "classificationRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "policyVersions" JSONB NOT NULL,
    "holdRevisions" JSONB NOT NULL,
    "approvals" JSONB NOT NULL DEFAULT '[]',
    "risk" JSONB NOT NULL DEFAULT '{}',
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "authorizationDecisionId" TEXT,
    "authorizationBindingHash" TEXT,
    "authorizationConsumedAt" TIMESTAMP(3),
    "governedCaseWorkItemId" TEXT,
    "terminalEvidence" JSONB,
    "authorizedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataControlOperation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DataControlOperationStep" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "pepKey" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "idempotencyKey" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "cursor" JSONB,
    "targetReceipt" JSONB,
    "verificationReceipt" JSONB,
    "errorClass" TEXT,
    "errorDetail" JSONB,
    "nextRetryAt" TIMESTAMP(3),
    "compensable" BOOLEAN NOT NULL DEFAULT false,
    "compensationKey" TEXT,
    "compensationReceipt" JSONB,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "compensatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataControlOperationStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataControlOperation_operationId_key" ON "DataControlOperation"("operationId");
CREATE UNIQUE INDEX "DataControlOperation_organizationId_idempotencyKey_key" ON "DataControlOperation"("organizationId", "idempotencyKey");
CREATE INDEX "DataControlOperation_organizationId_actionKey_createdAt_idx" ON "DataControlOperation"("organizationId", "actionKey", "createdAt");
CREATE INDEX "DataControlOperation_status_updatedAt_idx" ON "DataControlOperation"("status", "updatedAt");
CREATE INDEX "DataControlOperation_authorizationDecisionId_idx" ON "DataControlOperation"("authorizationDecisionId");
CREATE INDEX "DataControlOperation_governedCaseWorkItemId_idx" ON "DataControlOperation"("governedCaseWorkItemId");

CREATE UNIQUE INDEX "DataControlOperationStep_stepId_key" ON "DataControlOperationStep"("stepId");
CREATE UNIQUE INDEX "DataControlOperationStep_idempotencyKey_key" ON "DataControlOperationStep"("idempotencyKey");
CREATE UNIQUE INDEX "DataControlOperationStep_operationId_targetKey_key" ON "DataControlOperationStep"("operationId", "targetKey");
CREATE INDEX "DataControlOperationStep_operationId_sequence_idx" ON "DataControlOperationStep"("operationId", "sequence");
CREATE INDEX "DataControlOperationStep_status_nextRetryAt_idx" ON "DataControlOperationStep"("status", "nextRetryAt");
CREATE INDEX "DataControlOperationStep_leaseExpiresAt_idx" ON "DataControlOperationStep"("leaseExpiresAt");

ALTER TABLE "DataControlOperation" ADD CONSTRAINT "DataControlOperation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataControlOperation" ADD CONSTRAINT "DataControlOperation_authorizationDecisionId_fkey"
  FOREIGN KEY ("authorizationDecisionId") REFERENCES "AuthorizationDecisionLog"("decisionId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DataControlOperation" ADD CONSTRAINT "DataControlOperation_governedCaseWorkItemId_fkey"
  FOREIGN KEY ("governedCaseWorkItemId") REFERENCES "WorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DataControlOperationStep" ADD CONSTRAINT "DataControlOperationStep_operationId_fkey"
  FOREIGN KEY ("operationId") REFERENCES "DataControlOperation"("operationId") ON DELETE CASCADE ON UPDATE CASCADE;
