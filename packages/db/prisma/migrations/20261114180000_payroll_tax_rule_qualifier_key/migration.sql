-- BI-2BC8D614: federal withholding by IRS Pub 15-T Worksheet 1A.
--
-- 1. PayrollTaxRule.qualifierKey joins the unique key, so the rows of one
--    bracket table (same tax, kind, side and start date) are distinct figures.
--    Existing rows take "" and keep exactly the identity they had.
-- An employee's Form W-4 is recorded as an EmploymentEvent
-- ("withholding_recorded"), so no table is added.

ALTER TABLE "PayrollTaxRule" ADD COLUMN "qualifierKey" TEXT NOT NULL DEFAULT '';

DROP INDEX "PayrollTaxRule_jur_taxType_ruleKind_side_effectiveFrom_key";
-- @migration-safety: data-safe: this key is the previous unique key plus one column (qualifierKey, '' on every existing row), so it is strictly looser than the index it replaces and any row the old key admitted is unique under the new one.
CREATE UNIQUE INDEX "PayrollTaxRule_jur_taxType_ruleKind_side_qual_effectiveFrom_key"
  ON "PayrollTaxRule"("jurisdictionRefId", "taxType", "ruleKind", "side", "qualifierKey", "effectiveFrom");
