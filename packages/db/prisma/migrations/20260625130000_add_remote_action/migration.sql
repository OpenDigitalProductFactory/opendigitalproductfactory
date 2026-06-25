-- EP-REMOTE-ACTION · P1 — the convergent governed remote-execution primitive.
-- Spec: docs/superpowers/specs/2026-06-25-convergent-remote-action-execution-design.md.
-- One primitive consumed by federated remediation (EP-MSP-FEDERATION) + estate
-- patch-apply (EP-PATCH-MANAGEMENT §7.3). Additive only — no platform→Edge dispatch
-- channel ships here (that is P2, gated on machine-bound trust + a threat model), so
-- a materialized action rests at status='queued' and nothing executes.
CREATE TABLE "RemoteAction" (
    "id" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "edgeNodeId" TEXT,
    "inventoryEntityId" TEXT,
    "customerAccountId" TEXT,
    "customerSiteId" TEXT,
    "actionType" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "riskClass" TEXT NOT NULL DEFAULT 'read-only',
    "originProposalRef" TEXT,
    "originLinkId" TEXT,
    "requestedByPrincipalId" TEXT NOT NULL,
    "approvalState" TEXT NOT NULL DEFAULT 'proposed',
    "approvedByPrincipalId" TEXT,
    "changeRequestId" TEXT,
    "deploymentWindowId" TEXT,
    "patchPlanId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "result" JSONB NOT NULL DEFAULT '{}',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "rollbackOf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RemoteAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RemoteAction_actionKey_key" ON "RemoteAction"("actionKey");
CREATE INDEX "RemoteAction_originProposalRef_idx" ON "RemoteAction"("originProposalRef");
CREATE INDEX "RemoteAction_originLinkId_idx" ON "RemoteAction"("originLinkId");
CREATE INDEX "RemoteAction_approvalState_idx" ON "RemoteAction"("approvalState");
CREATE INDEX "RemoteAction_status_idx" ON "RemoteAction"("status");
CREATE INDEX "RemoteAction_customerAccountId_customerSiteId_idx" ON "RemoteAction"("customerAccountId", "customerSiteId");
