-- A resolution an owner can rule on (BI-3D0FB84B, EP-0AF96937).
--
-- Additive and standalone: no existing table changes, no backfill. Decisions
-- recorded before this migration simply have no proposal, which is exactly
-- true — nothing had drafted one. Every FK is ON DELETE SET NULL except the
-- decision and profile it belongs to, which cascade: a proposal for a deleted
-- decision is not evidence of anything.
CREATE TYPE "DecisionProposalScope" AS ENUM ('interaction', 'gap-cluster');
CREATE TYPE "DecisionProposalAction" AS ENUM ('answer-gap', 'adopt-option', 'adjust-weight', 'amend-stance', 'release-material', 'no-change');
CREATE TYPE "DecisionProposalStatus" AS ENUM ('proposed', 'accepted', 'amended', 'rejected');

CREATE TABLE IF NOT EXISTS "DecisionResolutionProposal" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "scopeKind" "DecisionProposalScope" NOT NULL,
    "interactionId" TEXT,
    "domainClass" TEXT,
    "profileId" TEXT NOT NULL,
    "actionKind" "DecisionProposalAction" NOT NULL,
    "draftPayload" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT NOT NULL,
    "consequences" JSONB NOT NULL DEFAULT '[]',
    "dissent" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION,
    "deliberationRunId" TEXT,
    "status" "DecisionProposalStatus" NOT NULL DEFAULT 'proposed',
    "ruledByUserId" TEXT,
    "ruledAt" TIMESTAMP(3),
    "rulingNote" TEXT,
    "acceptedPayload" JSONB,
    "replacedByProposalId" TEXT,
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "lifecycleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecisionResolutionProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DecisionResolutionProposal_proposalId_key" ON "DecisionResolutionProposal"("proposalId");
CREATE INDEX IF NOT EXISTS "DecisionResolutionProposal_status_createdAt_idx" ON "DecisionResolutionProposal"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "DecisionResolutionProposal_lifecycle_status_createdAt_idx" ON "DecisionResolutionProposal"("lifecycle", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "DecisionResolutionProposal_profileId_domainClass_status_idx" ON "DecisionResolutionProposal"("profileId", "domainClass", "status");
CREATE INDEX IF NOT EXISTS "DecisionResolutionProposal_interactionId_idx" ON "DecisionResolutionProposal"("interactionId");
CREATE INDEX IF NOT EXISTS "DecisionResolutionProposal_deliberationRunId_idx" ON "DecisionResolutionProposal"("deliberationRunId");
CREATE INDEX IF NOT EXISTS "DecisionResolutionProposal_ruledByUserId_idx" ON "DecisionResolutionProposal"("ruledByUserId");
CREATE INDEX IF NOT EXISTS "DecisionResolutionProposal_replacedByProposalId_idx" ON "DecisionResolutionProposal"("replacedByProposalId");

ALTER TABLE "DecisionResolutionProposal" ADD CONSTRAINT "DecisionResolutionProposal_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "DecisionInteraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionResolutionProposal" ADD CONSTRAINT "DecisionResolutionProposal_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "DecisionPerspectiveProfile"("profileId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionResolutionProposal" ADD CONSTRAINT "DecisionResolutionProposal_ruledByUserId_fkey" FOREIGN KEY ("ruledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DecisionResolutionProposal" ADD CONSTRAINT "DecisionResolutionProposal_deliberationRunId_fkey" FOREIGN KEY ("deliberationRunId") REFERENCES "DeliberationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DecisionResolutionProposal" ADD CONSTRAINT "DecisionResolutionProposal_replacedByProposalId_fkey" FOREIGN KEY ("replacedByProposalId") REFERENCES "DecisionResolutionProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
