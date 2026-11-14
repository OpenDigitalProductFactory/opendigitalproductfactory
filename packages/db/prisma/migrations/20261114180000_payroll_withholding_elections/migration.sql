-- BI-2BC8D614: federal withholding by IRS Pub 15-T Worksheet 1A.
--
-- 1. PayrollTaxRule.qualifierKey joins the unique key, so the rows of one
--    bracket table (same tax, kind, side and start date) are distinct figures.
--    Existing rows take "" and keep exactly the identity they had.
-- 2. EmployeeWithholdingElection records an employee's Form W-4.
-- Purely additive: no existing row changes meaning.

ALTER TABLE "PayrollTaxRule" ADD COLUMN "qualifierKey" TEXT NOT NULL DEFAULT '';

DROP INDEX "PayrollTaxRule_jur_taxType_ruleKind_side_effectiveFrom_key";
-- @migration-safety: data-safe: this key is the previous unique key plus one column (qualifierKey, '' on every existing row), so it is strictly looser than the index it replaces and any row the old key admitted is unique under the new one.
CREATE UNIQUE INDEX "PayrollTaxRule_jur_taxType_ruleKind_side_qual_effectiveFrom_key"
  ON "PayrollTaxRule"("jurisdictionRefId", "taxType", "ruleKind", "side", "qualifierKey", "effectiveFrom");

-- CreateEnum
CREATE TYPE "WithholdingFilingStatus" AS ENUM ('single', 'married_jointly', 'head_of_household');

-- CreateTable
CREATE TABLE "EmployeeWithholdingElection" (
    "id" TEXT NOT NULL,
    "employeeWithholdingElectionId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "filingStatus" "WithholdingFilingStatus" NOT NULL,
    "step2Checked" BOOLEAN NOT NULL DEFAULT false,
    "step3Credits" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "step4aOtherIncome" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "step4bDeductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "step4cExtraWithholding" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "exempt" BOOLEAN NOT NULL DEFAULT false,
    "workStateCode" TEXT,
    "recordedByUserId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "lifecycleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeWithholdingElection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeWithholdingElection_employeeWithholdingElectionId_key" ON "EmployeeWithholdingElection"("employeeWithholdingElectionId");
CREATE INDEX "EmployeeWithholdingElection_employeeProfileId_lifecycle_eff_idx" ON "EmployeeWithholdingElection"("employeeProfileId", "lifecycle", "effectiveFrom");
CREATE INDEX "EmployeeWithholdingElection_recordedByUserId_idx" ON "EmployeeWithholdingElection"("recordedByUserId");

ALTER TABLE "EmployeeWithholdingElection" ADD CONSTRAINT "EmployeeWithholdingElection_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeWithholdingElection" ADD CONSTRAINT "EmployeeWithholdingElection_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
