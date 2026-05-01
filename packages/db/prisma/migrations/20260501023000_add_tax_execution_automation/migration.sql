-- Add tax execution automation models for liability lineage, authority credentials,
-- and remittance run tracking.

CREATE TABLE "TaxDecisionSnapshot" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "organizationTaxProfileId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceLineItemId" TEXT,
    "taxType" TEXT NOT NULL,
    "taxCode" TEXT,
    "direction" TEXT NOT NULL,
    "taxableAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(65,30),
    "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "jurisdictionRefId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxDecisionSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxLiabilityEntry" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "organizationTaxProfileId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "periodId" TEXT,
    "decisionSnapshotId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceLineItemId" TEXT,
    "direction" TEXT NOT NULL,
    "taxableAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "notes" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxLiabilityEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxAuthorityCredential" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "organizationTaxProfileId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "authorityName" TEXT NOT NULL,
    "portalBaseUrl" TEXT,
    "credentialOwnerMode" TEXT NOT NULL DEFAULT 'business_shared',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "authMode" TEXT NOT NULL DEFAULT 'portal_username_password',
    "secretRef" TEXT,
    "mfaMode" TEXT NOT NULL DEFAULT 'human_step_up',
    "lastVerifiedAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxAuthorityCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxRemittanceRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "credentialId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "executionMode" TEXT NOT NULL DEFAULT 'manual',
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "confirmationRef" TEXT,
    "failureCode" TEXT,
    "failureDetails" TEXT,
    "createdByAgentId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRemittanceRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxDecisionSnapshot_snapshotId_key" ON "TaxDecisionSnapshot"("snapshotId");
CREATE INDEX "TaxDecisionSnapshot_organizationTaxProfileId_occurredAt_idx" ON "TaxDecisionSnapshot"("organizationTaxProfileId", "occurredAt");
CREATE INDEX "TaxDecisionSnapshot_registrationId_occurredAt_idx" ON "TaxDecisionSnapshot"("registrationId", "occurredAt");
CREATE INDEX "TaxDecisionSnapshot_sourceType_sourceId_idx" ON "TaxDecisionSnapshot"("sourceType", "sourceId");

CREATE UNIQUE INDEX "TaxLiabilityEntry_entryId_key" ON "TaxLiabilityEntry"("entryId");
CREATE INDEX "TaxLiabilityEntry_organizationTaxProfileId_occurredAt_idx" ON "TaxLiabilityEntry"("organizationTaxProfileId", "occurredAt");
CREATE INDEX "TaxLiabilityEntry_registrationId_periodId_idx" ON "TaxLiabilityEntry"("registrationId", "periodId");
CREATE INDEX "TaxLiabilityEntry_sourceType_sourceId_idx" ON "TaxLiabilityEntry"("sourceType", "sourceId");
CREATE INDEX "TaxLiabilityEntry_decisionSnapshotId_idx" ON "TaxLiabilityEntry"("decisionSnapshotId");

CREATE UNIQUE INDEX "TaxAuthorityCredential_credentialId_key" ON "TaxAuthorityCredential"("credentialId");
CREATE INDEX "TaxAuthorityCredential_organizationTaxProfileId_idx" ON "TaxAuthorityCredential"("organizationTaxProfileId");
CREATE INDEX "TaxAuthorityCredential_registrationId_status_idx" ON "TaxAuthorityCredential"("registrationId", "status");

CREATE UNIQUE INDEX "TaxRemittanceRun_runId_key" ON "TaxRemittanceRun"("runId");
CREATE INDEX "TaxRemittanceRun_periodId_status_idx" ON "TaxRemittanceRun"("periodId", "status");
CREATE INDEX "TaxRemittanceRun_credentialId_idx" ON "TaxRemittanceRun"("credentialId");
CREATE INDEX "TaxRemittanceRun_scheduledFor_status_idx" ON "TaxRemittanceRun"("scheduledFor", "status");

ALTER TABLE "TaxDecisionSnapshot"
ADD CONSTRAINT "TaxDecisionSnapshot_organizationTaxProfileId_fkey"
FOREIGN KEY ("organizationTaxProfileId") REFERENCES "OrganizationTaxProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaxDecisionSnapshot"
ADD CONSTRAINT "TaxDecisionSnapshot_registrationId_fkey"
FOREIGN KEY ("registrationId") REFERENCES "TaxRegistration"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaxLiabilityEntry"
ADD CONSTRAINT "TaxLiabilityEntry_organizationTaxProfileId_fkey"
FOREIGN KEY ("organizationTaxProfileId") REFERENCES "OrganizationTaxProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaxLiabilityEntry"
ADD CONSTRAINT "TaxLiabilityEntry_registrationId_fkey"
FOREIGN KEY ("registrationId") REFERENCES "TaxRegistration"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaxLiabilityEntry"
ADD CONSTRAINT "TaxLiabilityEntry_periodId_fkey"
FOREIGN KEY ("periodId") REFERENCES "TaxObligationPeriod"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaxLiabilityEntry"
ADD CONSTRAINT "TaxLiabilityEntry_decisionSnapshotId_fkey"
FOREIGN KEY ("decisionSnapshotId") REFERENCES "TaxDecisionSnapshot"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaxAuthorityCredential"
ADD CONSTRAINT "TaxAuthorityCredential_organizationTaxProfileId_fkey"
FOREIGN KEY ("organizationTaxProfileId") REFERENCES "OrganizationTaxProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaxAuthorityCredential"
ADD CONSTRAINT "TaxAuthorityCredential_registrationId_fkey"
FOREIGN KEY ("registrationId") REFERENCES "TaxRegistration"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaxRemittanceRun"
ADD CONSTRAINT "TaxRemittanceRun_periodId_fkey"
FOREIGN KEY ("periodId") REFERENCES "TaxObligationPeriod"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaxRemittanceRun"
ADD CONSTRAINT "TaxRemittanceRun_credentialId_fkey"
FOREIGN KEY ("credentialId") REFERENCES "TaxAuthorityCredential"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
