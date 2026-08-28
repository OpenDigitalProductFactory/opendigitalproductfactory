-- Worker classification: the legally-consequential axis behind an organisation's
-- own EmploymentType label (BI-C61CEEA9).
--
-- EmploymentType.name is free text an organisation types in. It carries no legal
-- meaning, so nothing downstream could ask the only question that matters — may
-- this worker be directed, scheduled, reviewed and provisioned the way an
-- employee is. This adds the axis that can be asked, plus the recorded human
-- determination behind it and the definite term a contingent engagement carries.
--
-- BACKFILL POSTURE — the important part of this file.
--
-- The classification column is NULLABLE and the backfill maps only labels it can
-- read unambiguously. Everything else is left NULL and surfaces as operator work.
-- That is deliberate: a guess here writes a legal claim into the database, and
-- every permissive guess errs toward directing someone the organisation may not
-- direct. An installation with messy labels therefore has manual work on upgrade.
-- That cost is correct.
--
-- Specifically NOT mapped, though it would be easy to:
--   * a bare "Contractor" / "Consultant" label — cannot distinguish a directly
--     engaged contractor from an agency-supplied one, and they differ on whether
--     a third party is the employer, which is exactly where co-employment sits.
--   * "Director" — a job title far more often than a board seat.
--   * "Temp" alone — may be a fixed-term employee rather than agency labour.
--
-- Existing behaviour is unchanged for every row: nothing reads this column yet.

-- CreateEnum
CREATE TYPE "WorkerClassification" AS ENUM (
  'employee',
  'contractor_direct',
  'contractor_agency',
  'temp_agency_worker',
  'eor_employee',
  'volunteer',
  'intern',
  'board_member'
);

-- AlterTable
ALTER TABLE "EmploymentType" ADD COLUMN "classification" "WorkerClassification";

-- CreateTable
CREATE TABLE "WorkerClassificationDetermination" (
    "id" TEXT NOT NULL,
    "determinationId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "classification" "WorkerClassification" NOT NULL,
    "determinedByUserId" TEXT NOT NULL,
    "jurisdictionSlug" TEXT,
    "evidence" JSONB,
    "rationale" TEXT,
    "determinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerClassificationDetermination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerEngagementTerm" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3) NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerEngagementTerm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmploymentType_classification_idx" ON "EmploymentType"("classification");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerClassificationDetermination_determinationId_key" ON "WorkerClassificationDetermination"("determinationId");
CREATE UNIQUE INDEX "WorkerClassificationDetermination_supersededById_key" ON "WorkerClassificationDetermination"("supersededById");
CREATE INDEX "WorkerClassificationDetermination_employeeProfileId_determin_idx" ON "WorkerClassificationDetermination"("employeeProfileId", "determinedAt" DESC);
CREATE INDEX "WorkerClassificationDetermination_classification_idx" ON "WorkerClassificationDetermination"("classification");
CREATE INDEX "WorkerClassificationDetermination_supersededAt_idx" ON "WorkerClassificationDetermination"("supersededAt");
CREATE INDEX "WorkerClassificationDetermination_determinedByUserId_idx" ON "WorkerClassificationDetermination"("determinedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerEngagementTerm_termId_key" ON "WorkerEngagementTerm"("termId");
CREATE UNIQUE INDEX "WorkerEngagementTerm_supersededById_key" ON "WorkerEngagementTerm"("supersededById");
CREATE INDEX "WorkerEngagementTerm_employeeProfileId_startsOn_idx" ON "WorkerEngagementTerm"("employeeProfileId", "startsOn" DESC);
CREATE INDEX "WorkerEngagementTerm_endsOn_idx" ON "WorkerEngagementTerm"("endsOn");
CREATE INDEX "WorkerEngagementTerm_supersededAt_idx" ON "WorkerEngagementTerm"("supersededAt");

-- AddForeignKey
ALTER TABLE "WorkerClassificationDetermination" ADD CONSTRAINT "WorkerClassificationDetermination_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkerClassificationDetermination" ADD CONSTRAINT "WorkerClassificationDetermination_determinedByUserId_fkey" FOREIGN KEY ("determinedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkerClassificationDetermination" ADD CONSTRAINT "WorkerClassificationDetermination_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "WorkerClassificationDetermination"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerEngagementTerm" ADD CONSTRAINT "WorkerEngagementTerm_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkerEngagementTerm" ADD CONSTRAINT "WorkerEngagementTerm_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "WorkerEngagementTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: unambiguous labels only. `\y` is a Postgres word boundary, so
-- "intern" does not match "internal" and "board" does not match "onboarding".
UPDATE "EmploymentType" SET "classification" = 'volunteer'
  WHERE "classification" IS NULL AND "name" ~* '\yvolunteers?\y';

UPDATE "EmploymentType" SET "classification" = 'intern'
  WHERE "classification" IS NULL AND "name" ~* '\yinterns?\y' AND "name" !~* '\yinternal\y';

UPDATE "EmploymentType" SET "classification" = 'board_member'
  WHERE "classification" IS NULL AND "name" ~* '\yboard\y';

UPDATE "EmploymentType" SET "classification" = 'eor_employee'
  WHERE "classification" IS NULL AND ("name" ~* '\yeor\y' OR "name" ~* 'employer of record');

-- Agency labour only where the label names the agency relationship itself.
UPDATE "EmploymentType" SET "classification" = 'temp_agency_worker'
  WHERE "classification" IS NULL
    AND "name" ~* '\yagency\y'
    AND "name" ~* '\y(temp|temporary|staffing)\y';

UPDATE "EmploymentType" SET "classification" = 'contractor_agency'
  WHERE "classification" IS NULL
    AND "name" ~* '\yagency\y'
    AND "name" ~* '\y(contractor|contract)\y';

-- Employment shapes that name the employment relationship unambiguously.
UPDATE "EmploymentType" SET "classification" = 'employee'
  WHERE "classification" IS NULL
    AND "name" ~* '\y(full[ -]?time|part[ -]?time|permanent|salaried|employee|staff)\y'
    AND "name" !~* '\y(contractor|contract|agency|volunteer|intern|board)\y';
