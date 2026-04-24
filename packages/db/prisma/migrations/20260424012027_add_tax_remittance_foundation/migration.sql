-- CreateTable
CREATE TABLE "OrganizationTaxProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "setupMode" TEXT NOT NULL DEFAULT 'unknown',
    "setupStatus" TEXT NOT NULL DEFAULT 'draft',
    "homeCountryCode" TEXT,
    "primaryRegionCode" TEXT,
    "taxModel" TEXT NOT NULL DEFAULT 'hybrid',
    "externalSystem" TEXT,
    "footprintSummary" TEXT,
    "notes" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationTaxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxJurisdictionReference" (
    "id" TEXT NOT NULL,
    "jurisdictionRefId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "stateProvinceCode" TEXT,
    "authorityName" TEXT NOT NULL,
    "authorityType" TEXT NOT NULL,
    "parentJurisdictionRefId" TEXT,
    "taxTypes" TEXT[],
    "localityModel" TEXT NOT NULL,
    "officialWebsiteUrl" TEXT,
    "registrationUrl" TEXT,
    "filingUrl" TEXT,
    "paymentUrl" TEXT,
    "helpUrl" TEXT,
    "cadenceHints" TEXT[],
    "filingNotes" TEXT,
    "automationHints" JSONB,
    "sourceUrls" TEXT[],
    "sourceKind" TEXT NOT NULL DEFAULT 'official',
    "lastResearchedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "staleAfterDays" INTEGER NOT NULL DEFAULT 180,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxJurisdictionReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRegistration" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "organizationTaxProfileId" TEXT NOT NULL,
    "jurisdictionReferenceId" TEXT NOT NULL,
    "taxType" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "registrationStatus" TEXT NOT NULL DEFAULT 'draft',
    "filingFrequency" TEXT NOT NULL,
    "filingBasis" TEXT,
    "remitterRole" TEXT NOT NULL DEFAULT 'business',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "firstPeriodStart" TIMESTAMP(3),
    "portalAccountNotes" TEXT,
    "verifiedFromSourceUrl" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxObligationPeriod" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "salesTaxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "inputTaxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "netTaxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "manualAdjustmentAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "exportStatus" TEXT NOT NULL DEFAULT 'not_started',
    "filedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "confirmationRef" TEXT,
    "preparedByAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxObligationPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxFilingArtifact" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "artifactType" TEXT NOT NULL,
    "storageKey" TEXT,
    "externalRef" TEXT,
    "sourceUrl" TEXT,
    "notes" TEXT,
    "createdByAgentId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxFilingArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxIssue" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "organizationTaxProfileId" TEXT NOT NULL,
    "registrationId" TEXT,
    "periodId" TEXT,
    "issueType" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "title" TEXT NOT NULL,
    "details" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationTaxProfile_organizationId_key" ON "OrganizationTaxProfile"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxJurisdictionReference_jurisdictionRefId_key" ON "TaxJurisdictionReference"("jurisdictionRefId");

-- CreateIndex
CREATE INDEX "TaxJurisdictionReference_countryCode_stateProvinceCode_idx" ON "TaxJurisdictionReference"("countryCode", "stateProvinceCode");

-- CreateIndex
CREATE INDEX "TaxJurisdictionReference_authorityType_idx" ON "TaxJurisdictionReference"("authorityType");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRegistration_registrationId_key" ON "TaxRegistration"("registrationId");

-- CreateIndex
CREATE INDEX "TaxRegistration_organizationTaxProfileId_idx" ON "TaxRegistration"("organizationTaxProfileId");

-- CreateIndex
CREATE INDEX "TaxRegistration_jurisdictionReferenceId_idx" ON "TaxRegistration"("jurisdictionReferenceId");

-- CreateIndex
CREATE INDEX "TaxRegistration_registrationStatus_idx" ON "TaxRegistration"("registrationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "TaxObligationPeriod_periodId_key" ON "TaxObligationPeriod"("periodId");

-- CreateIndex
CREATE INDEX "TaxObligationPeriod_registrationId_idx" ON "TaxObligationPeriod"("registrationId");

-- CreateIndex
CREATE INDEX "TaxObligationPeriod_status_dueDate_idx" ON "TaxObligationPeriod"("status", "dueDate");

-- CreateIndex
CREATE INDEX "TaxFilingArtifact_periodId_idx" ON "TaxFilingArtifact"("periodId");

-- CreateIndex
CREATE INDEX "TaxFilingArtifact_artifactType_idx" ON "TaxFilingArtifact"("artifactType");

-- CreateIndex
CREATE UNIQUE INDEX "TaxIssue_issueId_key" ON "TaxIssue"("issueId");

-- CreateIndex
CREATE INDEX "TaxIssue_organizationTaxProfileId_idx" ON "TaxIssue"("organizationTaxProfileId");

-- CreateIndex
CREATE INDEX "TaxIssue_registrationId_idx" ON "TaxIssue"("registrationId");

-- CreateIndex
CREATE INDEX "TaxIssue_periodId_idx" ON "TaxIssue"("periodId");

-- CreateIndex
CREATE INDEX "TaxIssue_status_severity_idx" ON "TaxIssue"("status", "severity");

-- AddForeignKey
ALTER TABLE "OrganizationTaxProfile" ADD CONSTRAINT "OrganizationTaxProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRegistration" ADD CONSTRAINT "TaxRegistration_organizationTaxProfileId_fkey" FOREIGN KEY ("organizationTaxProfileId") REFERENCES "OrganizationTaxProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRegistration" ADD CONSTRAINT "TaxRegistration_jurisdictionReferenceId_fkey" FOREIGN KEY ("jurisdictionReferenceId") REFERENCES "TaxJurisdictionReference"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxObligationPeriod" ADD CONSTRAINT "TaxObligationPeriod_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "TaxRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxFilingArtifact" ADD CONSTRAINT "TaxFilingArtifact_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "TaxObligationPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxIssue" ADD CONSTRAINT "TaxIssue_organizationTaxProfileId_fkey" FOREIGN KEY ("organizationTaxProfileId") REFERENCES "OrganizationTaxProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxIssue" ADD CONSTRAINT "TaxIssue_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "TaxRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxIssue" ADD CONSTRAINT "TaxIssue_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "TaxObligationPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
