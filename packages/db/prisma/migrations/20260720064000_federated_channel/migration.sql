-- Founder Hub partner-business records. External partner companies remain
-- separate from CustomerAccount and human identity remains Principal-based.
ALTER TABLE "FederationLink" ADD COLUMN "peerInstallationId" TEXT;
CREATE INDEX "FederationLink_peerInstallationId_idx" ON "FederationLink"("peerInstallationId");

CREATE TABLE "PartnerAccount" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "federationLinkId" TEXT,
    "externalOrganizationRef" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "partnerKind" TEXT NOT NULL DEFAULT 'reseller',
    "standing" TEXT NOT NULL DEFAULT 'pending',
    "tier" TEXT NOT NULL DEFAULT 'registered',
    "enrolledAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartnerAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerAgreement" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "partnerAccountId" TEXT NOT NULL,
    "agreementType" TEXT NOT NULL DEFAULT 'reseller',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "externalReference" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "terms" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartnerAgreement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerEntitlement" (
    "id" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "partnerAccountId" TEXT NOT NULL,
    "agreementId" TEXT,
    "serviceOfferingId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scope" JSONB,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartnerEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerSupportRoute" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "partnerAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "scope" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartnerSupportRoute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerContributionRecognition" (
    "id" TEXT NOT NULL,
    "recognitionId" TEXT NOT NULL,
    "partnerAccountId" TEXT NOT NULL,
    "contributionLedgerId" TEXT,
    "recognitionType" TEXT NOT NULL DEFAULT 'contribution',
    "status" TEXT NOT NULL DEFAULT 'recorded',
    "note" TEXT,
    "awardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartnerContributionRecognition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerAccount_partnerId_key" ON "PartnerAccount"("partnerId");
CREATE UNIQUE INDEX "PartnerAccount_federationLinkId_key" ON "PartnerAccount"("federationLinkId");
CREATE UNIQUE INDEX "PartnerAccount_organizationId_externalOrganizationRef_key" ON "PartnerAccount"("organizationId", "externalOrganizationRef");
CREATE INDEX "PartnerAccount_organizationId_standing_idx" ON "PartnerAccount"("organizationId", "standing");
CREATE INDEX "PartnerAccount_partnerKind_standing_idx" ON "PartnerAccount"("partnerKind", "standing");
CREATE UNIQUE INDEX "PartnerAgreement_agreementId_key" ON "PartnerAgreement"("agreementId");
CREATE INDEX "PartnerAgreement_partnerAccountId_status_idx" ON "PartnerAgreement"("partnerAccountId", "status");
CREATE INDEX "PartnerAgreement_effectiveTo_idx" ON "PartnerAgreement"("effectiveTo");
CREATE UNIQUE INDEX "PartnerEntitlement_entitlementId_key" ON "PartnerEntitlement"("entitlementId");
CREATE INDEX "PartnerEntitlement_partnerAccountId_status_idx" ON "PartnerEntitlement"("partnerAccountId", "status");
CREATE INDEX "PartnerEntitlement_agreementId_idx" ON "PartnerEntitlement"("agreementId");
CREATE INDEX "PartnerEntitlement_serviceOfferingId_idx" ON "PartnerEntitlement"("serviceOfferingId");
CREATE INDEX "PartnerEntitlement_effectiveTo_idx" ON "PartnerEntitlement"("effectiveTo");
CREATE UNIQUE INDEX "PartnerSupportRoute_routeId_key" ON "PartnerSupportRoute"("routeId");
CREATE INDEX "PartnerSupportRoute_partnerAccountId_active_priority_idx" ON "PartnerSupportRoute"("partnerAccountId", "active", "priority");
CREATE UNIQUE INDEX "PartnerContributionRecognition_recognitionId_key" ON "PartnerContributionRecognition"("recognitionId");
CREATE UNIQUE INDEX "PartnerContributionRecognition_partnerAccountId_contributionLedgerId_key" ON "PartnerContributionRecognition"("partnerAccountId", "contributionLedgerId");
CREATE INDEX "PartnerContributionRecognition_partnerAccountId_status_idx" ON "PartnerContributionRecognition"("partnerAccountId", "status");
CREATE INDEX "PartnerContributionRecognition_contributionLedgerId_idx" ON "PartnerContributionRecognition"("contributionLedgerId");

ALTER TABLE "PartnerAccount" ADD CONSTRAINT "PartnerAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerAccount" ADD CONSTRAINT "PartnerAccount_federationLinkId_fkey" FOREIGN KEY ("federationLinkId") REFERENCES "FederationLink"("linkId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartnerAgreement" ADD CONSTRAINT "PartnerAgreement_partnerAccountId_fkey" FOREIGN KEY ("partnerAccountId") REFERENCES "PartnerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerEntitlement" ADD CONSTRAINT "PartnerEntitlement_partnerAccountId_fkey" FOREIGN KEY ("partnerAccountId") REFERENCES "PartnerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerEntitlement" ADD CONSTRAINT "PartnerEntitlement_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "PartnerAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartnerEntitlement" ADD CONSTRAINT "PartnerEntitlement_serviceOfferingId_fkey" FOREIGN KEY ("serviceOfferingId") REFERENCES "ServiceOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartnerSupportRoute" ADD CONSTRAINT "PartnerSupportRoute_partnerAccountId_fkey" FOREIGN KEY ("partnerAccountId") REFERENCES "PartnerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerContributionRecognition" ADD CONSTRAINT "PartnerContributionRecognition_partnerAccountId_fkey" FOREIGN KEY ("partnerAccountId") REFERENCES "PartnerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerContributionRecognition" ADD CONSTRAINT "PartnerContributionRecognition_contributionLedgerId_fkey" FOREIGN KEY ("contributionLedgerId") REFERENCES "HiveContributionLedger"("id") ON DELETE SET NULL ON UPDATE CASCADE;
