-- Mileage absorption substrate (EP-MILEAGE-ABSORB: BI-6D98AD8A, BI-E17E0034)
-- Purely additive: new enums, tables, indexes and FKs. No existing column is
-- altered or dropped, so this applies cleanly against any existing data state.

-- CreateEnum
CREATE TYPE "MileageRatePurposeKind" AS ENUM ('business', 'medical', 'moving', 'charitable');

-- CreateEnum
CREATE TYPE "VehicleOwnershipKind" AS ENUM ('company', 'personal');

-- CreateEnum
CREATE TYPE "TripCaptureKind" AS ENUM ('automatic', 'manual', 'imported');

-- CreateEnum
CREATE TYPE "TripClassificationKind" AS ENUM ('unclassified', 'business', 'personal', 'commute');

-- CreateEnum
CREATE TYPE "TripClassifierKind" AS ENUM ('driver', 'rule', 'admin');

-- CreateEnum
CREATE TYPE "MileageRuleKind" AS ENUM ('repeated_route', 'work_hours', 'commute_exclusion');

-- CreateEnum
CREATE TYPE "MileageRuleScopeKind" AS ENUM ('driver', 'team', 'organization');

-- CreateEnum
CREATE TYPE "DriverLocationConsentStatus" AS ENUM ('pending', 'granted', 'revoked', 'expired');

-- CreateTable
CREATE TABLE "MileageRatePlan" (
    "id" TEXT NOT NULL,
    "mileageRatePlanId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jurisdictionRefId" TEXT,
    "name" TEXT NOT NULL,
    "isOrgOverride" BOOLEAN NOT NULL DEFAULT false,
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "lifecycleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MileageRatePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MileageRate" (
    "id" TEXT NOT NULL,
    "mileageRateId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "purposeKind" "MileageRatePurposeKind" NOT NULL DEFAULT 'business',
    "amountPerMile" DECIMAL(10,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MileageRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeProfileId" TEXT,
    "fixedAssetId" TEXT,
    "label" TEXT NOT NULL,
    "ownership" "VehicleOwnershipKind" NOT NULL,
    "registrationRef" TEXT,
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "lifecycleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "startLatitude" DECIMAL(10,7) NOT NULL,
    "startLongitude" DECIMAL(10,7) NOT NULL,
    "endLatitude" DECIMAL(10,7) NOT NULL,
    "endLongitude" DECIMAL(10,7) NOT NULL,
    "startPlaceLabel" TEXT,
    "endPlaceLabel" TEXT,
    "distanceMeters" INTEGER NOT NULL,
    "captureKind" "TripCaptureKind" NOT NULL,
    "classification" "TripClassificationKind" NOT NULL DEFAULT 'unclassified',
    "classifiedByKind" "TripClassifierKind",
    "classifiedAt" TIMESTAMP(3),
    "classificationRuleId" TEXT,
    "customerAccountId" TEXT,
    "mileageRateId" TEXT,
    "reimbursableAmount" DECIMAL(65,30),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "expenseItemId" TEXT,
    "notes" TEXT,
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "lifecycleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripClassificationRule" (
    "id" TEXT NOT NULL,
    "tripClassificationRuleId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeProfileId" TEXT,
    "ruleKind" "MileageRuleKind" NOT NULL,
    "scopeKind" "MileageRuleScopeKind" NOT NULL,
    "resultClassification" "TripClassificationKind" NOT NULL,
    "predicate" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "lifecycleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripClassificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverLocationConsent" (
    "id" TEXT NOT NULL,
    "driverLocationConsentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "consentStatus" "DriverLocationConsentStatus" NOT NULL DEFAULT 'pending',
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "retentionDays" INTEGER NOT NULL DEFAULT 365,
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverLocationConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MileageRatePlan_mileageRatePlanId_key" ON "MileageRatePlan"("mileageRatePlanId");

-- CreateIndex
CREATE INDEX "MileageRatePlan_organizationId_lifecycle_isOrgOverride_idx" ON "MileageRatePlan"("organizationId", "lifecycle", "isOrgOverride");

-- CreateIndex
CREATE INDEX "MileageRatePlan_jurisdictionRefId_idx" ON "MileageRatePlan"("jurisdictionRefId");

-- CreateIndex
CREATE UNIQUE INDEX "MileageRate_mileageRateId_key" ON "MileageRate"("mileageRateId");

-- CreateIndex
CREATE INDEX "MileageRate_planId_purposeKind_effectiveFrom_effectiveTo_idx" ON "MileageRate"("planId", "purposeKind", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "MileageRate_planId_purposeKind_effectiveFrom_key" ON "MileageRate"("planId", "purposeKind", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_vehicleId_key" ON "Vehicle"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_fixedAssetId_key" ON "Vehicle"("fixedAssetId");

-- CreateIndex
CREATE INDEX "Vehicle_organizationId_lifecycle_idx" ON "Vehicle"("organizationId", "lifecycle");

-- CreateIndex
CREATE INDEX "Vehicle_employeeProfileId_lifecycle_idx" ON "Vehicle"("employeeProfileId", "lifecycle");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_tripId_key" ON "Trip"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_expenseItemId_key" ON "Trip"("expenseItemId");

-- CreateIndex
CREATE INDEX "Trip_employeeProfileId_startedAt_idx" ON "Trip"("employeeProfileId", "startedAt");

-- CreateIndex
CREATE INDEX "Trip_organizationId_classification_startedAt_idx" ON "Trip"("organizationId", "classification", "startedAt");

-- CreateIndex
CREATE INDEX "Trip_vehicleId_startedAt_idx" ON "Trip"("vehicleId", "startedAt");

-- CreateIndex
CREATE INDEX "Trip_classificationRuleId_idx" ON "Trip"("classificationRuleId");

-- CreateIndex
CREATE INDEX "Trip_customerAccountId_startedAt_idx" ON "Trip"("customerAccountId", "startedAt");

-- CreateIndex
CREATE INDEX "Trip_mileageRateId_idx" ON "Trip"("mileageRateId");

-- CreateIndex
CREATE UNIQUE INDEX "TripClassificationRule_tripClassificationRuleId_key" ON "TripClassificationRule"("tripClassificationRuleId");

-- CreateIndex
CREATE INDEX "TripClassificationRule_organizationId_lifecycle_priority_idx" ON "TripClassificationRule"("organizationId", "lifecycle", "priority");

-- CreateIndex
CREATE INDEX "TripClassificationRule_employeeProfileId_lifecycle_idx" ON "TripClassificationRule"("employeeProfileId", "lifecycle");

-- CreateIndex
CREATE UNIQUE INDEX "DriverLocationConsent_driverLocationConsentId_key" ON "DriverLocationConsent"("driverLocationConsentId");

-- CreateIndex
CREATE INDEX "DriverLocationConsent_organizationId_consentStatus_idx" ON "DriverLocationConsent"("organizationId", "consentStatus");

-- CreateIndex
CREATE UNIQUE INDEX "DriverLocationConsent_employeeProfileId_policyVersion_key" ON "DriverLocationConsent"("employeeProfileId", "policyVersion");

-- AddForeignKey
ALTER TABLE "MileageRatePlan" ADD CONSTRAINT "MileageRatePlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MileageRatePlan" ADD CONSTRAINT "MileageRatePlan_jurisdictionRefId_fkey" FOREIGN KEY ("jurisdictionRefId") REFERENCES "TaxJurisdictionReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MileageRate" ADD CONSTRAINT "MileageRate_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MileageRatePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "FixedAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_classificationRuleId_fkey" FOREIGN KEY ("classificationRuleId") REFERENCES "TripClassificationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_mileageRateId_fkey" FOREIGN KEY ("mileageRateId") REFERENCES "MileageRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_expenseItemId_fkey" FOREIGN KEY ("expenseItemId") REFERENCES "ExpenseItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripClassificationRule" ADD CONSTRAINT "TripClassificationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripClassificationRule" ADD CONSTRAINT "TripClassificationRule_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverLocationConsent" ADD CONSTRAINT "DriverLocationConsent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverLocationConsent" ADD CONSTRAINT "DriverLocationConsent_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

