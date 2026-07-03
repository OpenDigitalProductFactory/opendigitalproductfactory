-- Phase 5 — compliance-coworker write-with-approval. Staging row for a change the
-- coworker PROPOSES (a control-obligation mapping, a new regulation, …) that a
-- human approves before it commits via the existing create/link actions.
CREATE TABLE "ComplianceProposal" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL,
    "rationale" TEXT,
    "proposedByAgentId" TEXT,
    "proposedByEmployeeId" TEXT,
    "reviewedByEmployeeId" TEXT,
    "reviewNotes" TEXT,
    "committedEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ComplianceProposal_proposalId_key" ON "ComplianceProposal" ("proposalId");
CREATE INDEX "ComplianceProposal_status_idx" ON "ComplianceProposal" ("status");
CREATE INDEX "ComplianceProposal_kind_idx" ON "ComplianceProposal" ("kind");
