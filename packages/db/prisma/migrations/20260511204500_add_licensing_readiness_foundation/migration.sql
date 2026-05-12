-- CreateTable
CREATE TABLE "OrganizationLicenseProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "setupStatus" TEXT NOT NULL DEFAULT 'draft',
    "investigationMode" TEXT NOT NULL DEFAULT 'unknown',
    "homeCountryCode" TEXT,
    "primaryRegionCode" TEXT,
    "operatingFootprintSummary" TEXT,
    "legalActivityConfidence" TEXT NOT NULL DEFAULT 'medium',
    "researchCoverageStatus" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationLicenseProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseRequirementReference" (
    "id" TEXT NOT NULL,
    "requirementRefId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "stateProvinceCode" TEXT,
    "jurisdictionLabel" TEXT NOT NULL,
    "authorityName" TEXT NOT NULL,
    "authorityType" TEXT NOT NULL,
    "requirementType" TEXT NOT NULL,
    "scopeLevel" TEXT NOT NULL,
    "archetypeCategories" TEXT[],
    "activityTags" TEXT[],
    "summary" TEXT NOT NULL,
    "officialWebsiteUrl" TEXT,
    "applicationUrl" TEXT,
    "renewalUrl" TEXT,
    "helpUrl" TEXT,
    "displayRuleSummary" TEXT,
    "renewalCadenceHint" TEXT,
    "sourceUrls" TEXT[],
    "sourceKind" TEXT NOT NULL DEFAULT 'official',
    "lastResearchedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "staleAfterDays" INTEGER NOT NULL DEFAULT 180,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseRequirementReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationLicenseRecord" (
    "id" TEXT NOT NULL,
    "licenseRecordId" TEXT NOT NULL,
    "organizationLicenseProfileId" TEXT NOT NULL,
    "requirementReferenceId" TEXT,
    "licenseKind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "licenseNumber" TEXT,
    "issuedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "renewalCadence" TEXT,
    "renewalFeeAmount" DECIMAL(12,2),
    "renewalFeeCurrency" TEXT,
    "displayRequirementStatus" TEXT NOT NULL DEFAULT 'unknown',
    "officialSourceUrl" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "verificationNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationLicenseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonLicenseRecord" (
    "id" TEXT NOT NULL,
    "personLicenseRecordId" TEXT NOT NULL,
    "principalAliasId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requirementReferenceId" TEXT,
    "credentialType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "credentialNumber" TEXT,
    "issuingAuthority" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "renewalCadence" TEXT,
    "supervisoryOrDisplayRole" TEXT,
    "officialSourceUrl" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonLicenseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseDisplayObligation" (
    "id" TEXT NOT NULL,
    "displayObligationId" TEXT NOT NULL,
    "organizationLicenseRecordId" TEXT,
    "personLicenseRecordId" TEXT,
    "evidenceId" TEXT,
    "displayType" TEXT NOT NULL,
    "requirementLevel" TEXT NOT NULL,
    "displayLocation" TEXT,
    "isSatisfied" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseDisplayObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseFeeSchedule" (
    "id" TEXT NOT NULL,
    "feeScheduleId" TEXT NOT NULL,
    "organizationLicenseRecordId" TEXT,
    "personLicenseRecordId" TEXT,
    "feeType" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "dueDate" TIMESTAMP(3),
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "financeHandoffMode" TEXT NOT NULL DEFAULT 'track_only',
    "externalReference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseFeeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseReadinessIssue" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "organizationLicenseProfileId" TEXT NOT NULL,
    "organizationLicenseRecordId" TEXT,
    "personLicenseRecordId" TEXT,
    "issueType" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "title" TEXT NOT NULL,
    "details" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseReadinessIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationLicenseProfile_organizationId_key" ON "OrganizationLicenseProfile"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseRequirementReference_requirementRefId_key" ON "LicenseRequirementReference"("requirementRefId");
CREATE INDEX "LicenseRequirementReference_countryCode_stateProvinceCode_idx" ON "LicenseRequirementReference"("countryCode", "stateProvinceCode");
CREATE INDEX "LicenseRequirementReference_requirementType_idx" ON "LicenseRequirementReference"("requirementType");
CREATE INDEX "LicenseRequirementReference_authorityType_idx" ON "LicenseRequirementReference"("authorityType");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationLicenseRecord_licenseRecordId_key" ON "OrganizationLicenseRecord"("licenseRecordId");
CREATE INDEX "OrganizationLicenseRecord_organizationLicenseProfileId_idx" ON "OrganizationLicenseRecord"("organizationLicenseProfileId");
CREATE INDEX "OrganizationLicenseRecord_requirementReferenceId_idx" ON "OrganizationLicenseRecord"("requirementReferenceId");
CREATE INDEX "OrganizationLicenseRecord_status_expiresAt_idx" ON "OrganizationLicenseRecord"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PersonLicenseRecord_personLicenseRecordId_key" ON "PersonLicenseRecord"("personLicenseRecordId");
CREATE INDEX "PersonLicenseRecord_principalAliasId_idx" ON "PersonLicenseRecord"("principalAliasId");
CREATE INDEX "PersonLicenseRecord_organizationId_idx" ON "PersonLicenseRecord"("organizationId");
CREATE INDEX "PersonLicenseRecord_requirementReferenceId_idx" ON "PersonLicenseRecord"("requirementReferenceId");
CREATE INDEX "PersonLicenseRecord_status_expiresAt_idx" ON "PersonLicenseRecord"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseDisplayObligation_displayObligationId_key" ON "LicenseDisplayObligation"("displayObligationId");
CREATE INDEX "LicenseDisplayObligation_organizationLicenseRecordId_idx" ON "LicenseDisplayObligation"("organizationLicenseRecordId");
CREATE INDEX "LicenseDisplayObligation_personLicenseRecordId_idx" ON "LicenseDisplayObligation"("personLicenseRecordId");
CREATE INDEX "LicenseDisplayObligation_evidenceId_idx" ON "LicenseDisplayObligation"("evidenceId");
CREATE INDEX "LicenseDisplayObligation_requirementLevel_isSatisfied_idx" ON "LicenseDisplayObligation"("requirementLevel", "isSatisfied");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseFeeSchedule_feeScheduleId_key" ON "LicenseFeeSchedule"("feeScheduleId");
CREATE INDEX "LicenseFeeSchedule_organizationLicenseRecordId_idx" ON "LicenseFeeSchedule"("organizationLicenseRecordId");
CREATE INDEX "LicenseFeeSchedule_personLicenseRecordId_idx" ON "LicenseFeeSchedule"("personLicenseRecordId");
CREATE INDEX "LicenseFeeSchedule_paymentStatus_dueDate_idx" ON "LicenseFeeSchedule"("paymentStatus", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseReadinessIssue_issueId_key" ON "LicenseReadinessIssue"("issueId");
CREATE INDEX "LicenseReadinessIssue_organizationLicenseProfileId_idx" ON "LicenseReadinessIssue"("organizationLicenseProfileId");
CREATE INDEX "LicenseReadinessIssue_organizationLicenseRecordId_idx" ON "LicenseReadinessIssue"("organizationLicenseRecordId");
CREATE INDEX "LicenseReadinessIssue_personLicenseRecordId_idx" ON "LicenseReadinessIssue"("personLicenseRecordId");
CREATE INDEX "LicenseReadinessIssue_status_severity_idx" ON "LicenseReadinessIssue"("status", "severity");

-- AddForeignKey
ALTER TABLE "OrganizationLicenseProfile"
ADD CONSTRAINT "OrganizationLicenseProfile_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationLicenseRecord"
ADD CONSTRAINT "OrganizationLicenseRecord_organizationLicenseProfileId_fkey"
FOREIGN KEY ("organizationLicenseProfileId") REFERENCES "OrganizationLicenseProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationLicenseRecord"
ADD CONSTRAINT "OrganizationLicenseRecord_requirementReferenceId_fkey"
FOREIGN KEY ("requirementReferenceId") REFERENCES "LicenseRequirementReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonLicenseRecord"
ADD CONSTRAINT "PersonLicenseRecord_principalAliasId_fkey"
FOREIGN KEY ("principalAliasId") REFERENCES "PrincipalAlias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PersonLicenseRecord"
ADD CONSTRAINT "PersonLicenseRecord_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PersonLicenseRecord"
ADD CONSTRAINT "PersonLicenseRecord_requirementReferenceId_fkey"
FOREIGN KEY ("requirementReferenceId") REFERENCES "LicenseRequirementReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseDisplayObligation"
ADD CONSTRAINT "LicenseDisplayObligation_organizationLicenseRecordId_fkey"
FOREIGN KEY ("organizationLicenseRecordId") REFERENCES "OrganizationLicenseRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LicenseDisplayObligation"
ADD CONSTRAINT "LicenseDisplayObligation_personLicenseRecordId_fkey"
FOREIGN KEY ("personLicenseRecordId") REFERENCES "PersonLicenseRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LicenseDisplayObligation"
ADD CONSTRAINT "LicenseDisplayObligation_evidenceId_fkey"
FOREIGN KEY ("evidenceId") REFERENCES "ComplianceEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseFeeSchedule"
ADD CONSTRAINT "LicenseFeeSchedule_organizationLicenseRecordId_fkey"
FOREIGN KEY ("organizationLicenseRecordId") REFERENCES "OrganizationLicenseRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LicenseFeeSchedule"
ADD CONSTRAINT "LicenseFeeSchedule_personLicenseRecordId_fkey"
FOREIGN KEY ("personLicenseRecordId") REFERENCES "PersonLicenseRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseReadinessIssue"
ADD CONSTRAINT "LicenseReadinessIssue_organizationLicenseProfileId_fkey"
FOREIGN KEY ("organizationLicenseProfileId") REFERENCES "OrganizationLicenseProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LicenseReadinessIssue"
ADD CONSTRAINT "LicenseReadinessIssue_organizationLicenseRecordId_fkey"
FOREIGN KEY ("organizationLicenseRecordId") REFERENCES "OrganizationLicenseRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LicenseReadinessIssue"
ADD CONSTRAINT "LicenseReadinessIssue_personLicenseRecordId_fkey"
FOREIGN KEY ("personLicenseRecordId") REFERENCES "PersonLicenseRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
