-- EP-MSP-FEDERATION · Phase 3 (BI-3179B48E / BI-E2398997 / BI-3C21D4E2).
-- B3+B5 generic record mirror/crosswalk + B4 cross-org remediation proposal.
CREATE TABLE "FederatedRecordMirror" (
    "id" TEXT NOT NULL,
    "mirrorId" TEXT NOT NULL,
    "federationLinkId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "canonicalSide" TEXT NOT NULL,
    "localRecordRef" TEXT,
    "peerRecordRef" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "conflictReason" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FederatedRecordMirror_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FederatedRecordMirror_mirrorId_key" ON "FederatedRecordMirror"("mirrorId");
CREATE UNIQUE INDEX "FederatedRecordMirror_link_type_local_key" ON "FederatedRecordMirror"("federationLinkId", "recordType", "localRecordRef");
CREATE INDEX "FederatedRecordMirror_federationLinkId_idx" ON "FederatedRecordMirror"("federationLinkId");
CREATE INDEX "FederatedRecordMirror_recordType_idx" ON "FederatedRecordMirror"("recordType");
CREATE INDEX "FederatedRecordMirror_syncStatus_idx" ON "FederatedRecordMirror"("syncStatus");

CREATE TABLE "FederatedRemediationProposal" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "federationLinkId" TEXT NOT NULL,
    "incidentKey" TEXT NOT NULL,
    "edgeNodeId" TEXT,
    "actions" JSONB NOT NULL,
    "overallDecision" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "attentionItemRef" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByPrincipalId" TEXT,
    "executedAt" TIMESTAMP(3),
    "executionEvidenceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FederatedRemediationProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FederatedRemediationProposal_proposalId_key" ON "FederatedRemediationProposal"("proposalId");
CREATE INDEX "FederatedRemediationProposal_federationLinkId_idx" ON "FederatedRemediationProposal"("federationLinkId");
CREATE INDEX "FederatedRemediationProposal_status_idx" ON "FederatedRemediationProposal"("status");
CREATE INDEX "FederatedRemediationProposal_incidentKey_idx" ON "FederatedRemediationProposal"("incidentKey");
