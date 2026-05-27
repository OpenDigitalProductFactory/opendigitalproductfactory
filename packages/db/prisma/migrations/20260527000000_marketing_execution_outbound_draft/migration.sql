-- EP-MARKETING-EXEC Phase 1: outbound execution substrate.
-- Generic outbound-draft + approval-decision tables with a domain
-- discriminator. Marketing is the first domain; future coworker domains
-- (customer-advisor, ops-coordinator, build-specialist) join without a
-- rename migration. Typed status catalog lives at
-- apps/web/lib/marketing/execution.ts.

CREATE TABLE IF NOT EXISTS "OutboundDraft" (
    "draftId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "strategyId" TEXT,
    "status" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "bodyFormat" TEXT NOT NULL,
    "metadata" JSONB,
    "createdByAgentId" TEXT,
    "originalPromptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundDraft_pkey" PRIMARY KEY ("draftId")
);

CREATE INDEX IF NOT EXISTS "OutboundDraft_organizationId_domain_status_idx"
    ON "OutboundDraft"("organizationId", "domain", "status");

CREATE INDEX IF NOT EXISTS "OutboundDraft_sourceType_sourceId_idx"
    ON "OutboundDraft"("sourceType", "sourceId");

CREATE INDEX IF NOT EXISTS "OutboundDraft_channelId_status_idx"
    ON "OutboundDraft"("channelId", "status");

CREATE TABLE IF NOT EXISTS "OutboundApprovalDecision" (
    "decisionId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "editedBody" TEXT,
    "notes" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundApprovalDecision_pkey" PRIMARY KEY ("decisionId")
);

CREATE INDEX IF NOT EXISTS "OutboundApprovalDecision_draftId_idx"
    ON "OutboundApprovalDecision"("draftId");

CREATE INDEX IF NOT EXISTS "OutboundApprovalDecision_reviewerUserId_decidedAt_idx"
    ON "OutboundApprovalDecision"("reviewerUserId", "decidedAt");

ALTER TABLE "OutboundApprovalDecision"
    ADD CONSTRAINT "OutboundApprovalDecision_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "OutboundDraft"("draftId")
    ON DELETE CASCADE ON UPDATE CASCADE;
