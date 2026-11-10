-- Expand-only Pet Rescue operating model. Existing public listings receive a
-- durable identity; no custody, care, application, placement, or ledger facts
-- are inferred from storefront copy.
CREATE TYPE "AnimalLifecycleStatus" AS ENUM ('in-care', 'placement-ready', 'placed', 'outcome-recorded', 'inactive');
CREATE TYPE "AnimalCustodyStage" AS ENUM ('intake', 'legal-hold', 'quarantine', 'health-assessment', 'procedures', 'behavior-assessment', 'care', 'placement-ready', 'outcome-recorded');
CREATE TYPE "AnimalIntakeType" AS ENUM ('stray', 'owner-relinquished', 'seizure-confiscate', 'transfer-in', 'born-in-care', 'return', 'other');
CREATE TYPE "AnimalOutcomeType" AS ENUM ('adoption', 'return-to-owner', 'return-to-field', 'transfer-out', 'died-in-care', 'euthanasia', 'lost-in-care', 'other');
CREATE TYPE "AnimalAdoptionApplicationStatus" AS ENUM ('submitted', 'screening', 'meet-and-greet', 'home-check', 'approved', 'waitlisted', 'declined', 'withdrawn', 'placed', 'closed');
CREATE TYPE "AnimalPlacementStatus" AS ENUM ('reserved', 'active', 'returned', 'cancelled');
CREATE TYPE "AnimalCustodyEventKind" AS ENUM ('stage-transition', 'legal-hold-released', 'correction');
CREATE TYPE "CareRecordKind" AS ENUM ('condition', 'allergy', 'medication', 'vaccination', 'procedure', 'weight', 'observation', 'behavior', 'note');
CREATE TYPE "CareRecordStatus" AS ENUM ('active', 'superseded', 'entered-in-error');
CREATE TYPE "FinancialFundRestriction" AS ENUM ('unrestricted', 'temporarily-restricted', 'permanently-restricted');

CREATE TABLE "AnimalProfile" (
  "id" TEXT NOT NULL,
  "animalRef" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storefrontId" TEXT,
  "externalSourceKey" TEXT,
  "name" TEXT NOT NULL,
  "species" TEXT,
  "breed" TEXT,
  "sex" TEXT,
  "birthDate" TIMESTAMP(3),
  "approximateAge" TEXT,
  "microchipNumber" TEXT,
  "lifecycleStatus" "AnimalLifecycleStatus" NOT NULL DEFAULT 'in-care',
  "source" TEXT NOT NULL DEFAULT 'operator',
  "sourceRef" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnimalProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnimalCustodyEpisode" (
  "id" TEXT NOT NULL, "episodeRef" TEXT NOT NULL, "organizationId" TEXT NOT NULL,
  "animalProfileId" TEXT NOT NULL, "episodeNumber" INTEGER NOT NULL,
  "intakeType" "AnimalIntakeType" NOT NULL, "intakeSource" TEXT, "intakeLocation" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL, "currentStage" "AnimalCustodyStage" NOT NULL DEFAULT 'intake',
  "legalHoldActive" BOOLEAN NOT NULL DEFAULT false, "legalHoldReason" TEXT,
  "closedAt" TIMESTAMP(3), "outcomeType" "AnimalOutcomeType", "outcomeReason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnimalCustodyEpisode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnimalCustodyEvent" (
  "id" TEXT NOT NULL, "eventRef" TEXT NOT NULL, "organizationId" TEXT NOT NULL,
  "animalProfileId" TEXT NOT NULL, "custodyEpisodeId" TEXT NOT NULL, "sequence" INTEGER NOT NULL,
  "fromStage" "AnimalCustodyStage", "toStage" "AnimalCustodyStage" NOT NULL,
  "kind" "AnimalCustodyEventKind" NOT NULL DEFAULT 'stage-transition', "reason" TEXT, "actorPrincipalRef" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnimalCustodyEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnimalAdoptionApplication" (
  "id" TEXT NOT NULL, "applicationRef" TEXT NOT NULL, "organizationId" TEXT NOT NULL,
  "animalProfileId" TEXT NOT NULL, "inquiryRef" TEXT, "applicantContactRef" TEXT, "applicantName" TEXT,
  "status" "AnimalAdoptionApplicationStatus" NOT NULL DEFAULT 'submitted', "reviewerPrincipalRef" TEXT,
  "decisionReason" TEXT, "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3), "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnimalAdoptionApplication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnimalPlacement" (
  "id" TEXT NOT NULL, "placementRef" TEXT NOT NULL, "organizationId" TEXT NOT NULL,
  "animalProfileId" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "adopterContactRef" TEXT,
  "status" "AnimalPlacementStatus" NOT NULL DEFAULT 'reserved', "placedAt" TIMESTAMP(3),
  "returnedAt" TIMESTAMP(3), "returnReason" TEXT, "adoptionFeeAmount" DECIMAL(65,30),
  "currency" TEXT NOT NULL DEFAULT 'USD', "paymentRef" TEXT, "allocationRef" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnimalPlacement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CareRecord" (
  "id" TEXT NOT NULL, "careRecordId" TEXT NOT NULL, "organizationId" TEXT NOT NULL,
  "subjectKindSlug" TEXT NOT NULL, "subjectRef" TEXT NOT NULL, "kind" "CareRecordKind" NOT NULL,
  "status" "CareRecordStatus" NOT NULL DEFAULT 'active', "code" TEXT, "display" TEXT, "value" TEXT,
  "quantity" DECIMAL(65,30), "unit" TEXT, "effectiveAt" TIMESTAMP(3) NOT NULL,
  "effectiveUntil" TIMESTAMP(3), "detail" JSONB, "source" TEXT NOT NULL DEFAULT 'operator',
  "sourceRef" TEXT, "authorPrincipalRef" TEXT NOT NULL, "sensitivity" TEXT NOT NULL DEFAULT 'internal',
  "retentionPolicyKey" TEXT, "legalHold" BOOLEAN NOT NULL DEFAULT false, "correctsId" TEXT,
  "supersededById" TEXT, "correctionReason" TEXT, "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CareRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialFund" (
  "id" TEXT NOT NULL, "fundRef" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "fundKey" TEXT NOT NULL,
  "name" TEXT NOT NULL, "description" TEXT, "restriction" "FinancialFundRestriction" NOT NULL DEFAULT 'unrestricted',
  "purpose" TEXT, "currency" TEXT NOT NULL DEFAULT 'USD', "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3), "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialFund_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AdoptableAnimal" ADD COLUMN "animalProfileId" TEXT;
ALTER TABLE "StorefrontDonation" ADD COLUMN "fundId" TEXT;
ALTER TABLE "WorkEngagement" ADD COLUMN "subjectKindSlug" TEXT;
ALTER TABLE "WorkEngagement" ADD COLUMN "subjectRef" TEXT;
ALTER TABLE "WorkEngagement" ADD COLUMN "locationResourceRef" TEXT;
ALTER TABLE "JournalLine" ADD COLUMN "fundId" TEXT;
ALTER TABLE "JournalLine" ADD COLUMN "subjectKindSlug" TEXT;
ALTER TABLE "JournalLine" ADD COLUMN "subjectRef" TEXT;

INSERT INTO "AnimalProfile" (
  "id", "animalRef", "organizationId", "storefrontId", "name", "species", "breed", "sex",
  "approximateAge", "lifecycleStatus", "source", "sourceRef", "createdAt", "updatedAt"
)
SELECT
  'animal_' || md5(a."organizationId" || ':' || a."animalRef"), a."animalRef", a."organizationId",
  a."storefrontId", a."name", a."species", a."breed", a."sex", a."age",
  CASE WHEN a."status" = 'adopted' THEN 'placed'::"AnimalLifecycleStatus"
       WHEN a."status" = 'available' THEN 'placement-ready'::"AnimalLifecycleStatus"
       ELSE 'in-care'::"AnimalLifecycleStatus" END,
  'storefront-backfill', a."animalRef", a."createdAt", a."updatedAt"
FROM "AdoptableAnimal" a;

UPDATE "AdoptableAnimal" a
SET "animalProfileId" = p."id"
FROM "AnimalProfile" p
WHERE p."organizationId" = a."organizationId" AND p."animalRef" = a."animalRef";

CREATE UNIQUE INDEX "AnimalProfile_organizationId_animalRef_key" ON "AnimalProfile"("organizationId", "animalRef");
CREATE UNIQUE INDEX "AnimalProfile_organizationId_externalSourceKey_key" ON "AnimalProfile"("organizationId", "externalSourceKey");
CREATE UNIQUE INDEX "AnimalProfile_id_organizationId_key" ON "AnimalProfile"("id", "organizationId");
CREATE INDEX "AnimalProfile_organizationId_lifecycleStatus_updatedAt_idx" ON "AnimalProfile"("organizationId", "lifecycleStatus", "updatedAt");
CREATE INDEX "AnimalProfile_storefrontId_idx" ON "AnimalProfile"("storefrontId");
CREATE UNIQUE INDEX "AdoptableAnimal_animalProfileId_key" ON "AdoptableAnimal"("animalProfileId");

CREATE UNIQUE INDEX "AnimalCustodyEpisode_episodeRef_key" ON "AnimalCustodyEpisode"("episodeRef");
CREATE UNIQUE INDEX "AnimalCustodyEpisode_animalProfileId_episodeNumber_key" ON "AnimalCustodyEpisode"("animalProfileId", "episodeNumber");
CREATE UNIQUE INDEX "AnimalCustodyEpisode_id_organizationId_key" ON "AnimalCustodyEpisode"("id", "organizationId");
CREATE INDEX "AnimalCustodyEpisode_animalProfileId_organizationId_idx" ON "AnimalCustodyEpisode"("animalProfileId", "organizationId");
CREATE INDEX "AnimalCustodyEpisode_organizationId_currentStage_openedAt_idx" ON "AnimalCustodyEpisode"("organizationId", "currentStage", "openedAt");
CREATE UNIQUE INDEX "AnimalCustodyEvent_eventRef_key" ON "AnimalCustodyEvent"("eventRef");
CREATE UNIQUE INDEX "AnimalCustodyEvent_custodyEpisodeId_sequence_key" ON "AnimalCustodyEvent"("custodyEpisodeId", "sequence");
CREATE INDEX "AnimalCustodyEvent_custodyEpisodeId_organizationId_idx" ON "AnimalCustodyEvent"("custodyEpisodeId", "organizationId");
CREATE INDEX "AnimalCustodyEvent_organizationId_animalProfileId_occurredAt_idx" ON "AnimalCustodyEvent"("organizationId", "animalProfileId", "occurredAt");
CREATE UNIQUE INDEX "AnimalAdoptionApplication_applicationRef_key" ON "AnimalAdoptionApplication"("applicationRef");
CREATE UNIQUE INDEX "AnimalAdoptionApplication_id_organizationId_key" ON "AnimalAdoptionApplication"("id", "organizationId");
CREATE INDEX "AnimalAdoptionApplication_organizationId_status_submittedAt_idx" ON "AnimalAdoptionApplication"("organizationId", "status", "submittedAt");
CREATE INDEX "AnimalAdoptionApplication_organizationId_animalProfileId_status_idx" ON "AnimalAdoptionApplication"("organizationId", "animalProfileId", "status");
CREATE UNIQUE INDEX "AnimalPlacement_placementRef_key" ON "AnimalPlacement"("placementRef");
CREATE UNIQUE INDEX "AnimalPlacement_applicationId_key" ON "AnimalPlacement"("applicationId");
CREATE UNIQUE INDEX "AnimalPlacement_id_organizationId_key" ON "AnimalPlacement"("id", "organizationId");
CREATE INDEX "AnimalPlacement_organizationId_status_placedAt_idx" ON "AnimalPlacement"("organizationId", "status", "placedAt");
CREATE INDEX "AnimalPlacement_organizationId_animalProfileId_createdAt_idx" ON "AnimalPlacement"("organizationId", "animalProfileId", "createdAt");
CREATE UNIQUE INDEX "CareRecord_careRecordId_key" ON "CareRecord"("careRecordId");
CREATE UNIQUE INDEX "CareRecord_correctsId_key" ON "CareRecord"("correctsId");
CREATE UNIQUE INDEX "CareRecord_supersededById_key" ON "CareRecord"("supersededById");
CREATE INDEX "CareRecord_organizationId_subjectKindSlug_subjectRef_effectiveAt_idx" ON "CareRecord"("organizationId", "subjectKindSlug", "subjectRef", "effectiveAt");
CREATE INDEX "CareRecord_organizationId_kind_status_effectiveAt_idx" ON "CareRecord"("organizationId", "kind", "status", "effectiveAt");
CREATE UNIQUE INDEX "FinancialFund_fundRef_key" ON "FinancialFund"("fundRef");
CREATE UNIQUE INDEX "FinancialFund_organizationId_fundKey_key" ON "FinancialFund"("organizationId", "fundKey");
CREATE INDEX "FinancialFund_organizationId_isActive_restriction_idx" ON "FinancialFund"("organizationId", "isActive", "restriction");
CREATE INDEX "StorefrontDonation_fundId_idx" ON "StorefrontDonation"("fundId");
CREATE INDEX "WorkEngagement_organizationId_subjectKindSlug_subjectRef_idx" ON "WorkEngagement"("organizationId", "subjectKindSlug", "subjectRef");
CREATE INDEX "WorkEngagement_organizationId_locationResourceRef_dueAt_idx" ON "WorkEngagement"("organizationId", "locationResourceRef", "dueAt");
CREATE INDEX "JournalLine_fundId_idx" ON "JournalLine"("fundId");
CREATE INDEX "JournalLine_subjectKindSlug_subjectRef_idx" ON "JournalLine"("subjectKindSlug", "subjectRef");

ALTER TABLE "AnimalProfile" ADD CONSTRAINT "AnimalProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnimalProfile" ADD CONSTRAINT "AnimalProfile_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "StorefrontConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdoptableAnimal" ADD CONSTRAINT "AdoptableAnimal_animalProfileId_fkey" FOREIGN KEY ("animalProfileId") REFERENCES "AnimalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnimalCustodyEpisode" ADD CONSTRAINT "AnimalCustodyEpisode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnimalCustodyEpisode" ADD CONSTRAINT "AnimalCustodyEpisode_animalProfileId_organizationId_fkey" FOREIGN KEY ("animalProfileId", "organizationId") REFERENCES "AnimalProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnimalCustodyEvent" ADD CONSTRAINT "AnimalCustodyEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnimalCustodyEvent" ADD CONSTRAINT "AnimalCustodyEvent_animalProfileId_organizationId_fkey" FOREIGN KEY ("animalProfileId", "organizationId") REFERENCES "AnimalProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnimalCustodyEvent" ADD CONSTRAINT "AnimalCustodyEvent_custodyEpisodeId_organizationId_fkey" FOREIGN KEY ("custodyEpisodeId", "organizationId") REFERENCES "AnimalCustodyEpisode"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnimalAdoptionApplication" ADD CONSTRAINT "AnimalAdoptionApplication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnimalAdoptionApplication" ADD CONSTRAINT "AnimalAdoptionApplication_animalProfileId_organizationId_fkey" FOREIGN KEY ("animalProfileId", "organizationId") REFERENCES "AnimalProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnimalPlacement" ADD CONSTRAINT "AnimalPlacement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnimalPlacement" ADD CONSTRAINT "AnimalPlacement_animalProfileId_organizationId_fkey" FOREIGN KEY ("animalProfileId", "organizationId") REFERENCES "AnimalProfile"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnimalPlacement" ADD CONSTRAINT "AnimalPlacement_applicationId_organizationId_fkey" FOREIGN KEY ("applicationId", "organizationId") REFERENCES "AnimalAdoptionApplication"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CareRecord" ADD CONSTRAINT "CareRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CareRecord" ADD CONSTRAINT "CareRecord_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "CareRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CareRecord" ADD CONSTRAINT "CareRecord_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "CareRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialFund" ADD CONSTRAINT "FinancialFund_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- @migration-safety: data-safe: fundId is a newly added nullable column, so every pre-existing donation is NULL before this constraint is installed.
ALTER TABLE "StorefrontDonation" ADD CONSTRAINT "StorefrontDonation_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "FinancialFund"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- @migration-safety: data-safe: fundId is a newly added nullable column, so every pre-existing journal line is NULL before this constraint is installed.
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "FinancialFund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
