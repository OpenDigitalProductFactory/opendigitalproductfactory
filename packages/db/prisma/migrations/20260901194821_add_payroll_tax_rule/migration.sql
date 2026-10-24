-- The home a cited statutory figure lands in (BI-8E1FD1BD, BI-4EB27955 item 3).
--
-- Until now the tax spine could compute but had nowhere to keep a figure with
-- its citation, so the engine was correct and unusable at the same time. Every
-- row carries the authority's own publication URL and the date it was read,
-- because a figure that cannot be cited must never drive a filing.
--
-- The status column is the safety gate: a coworker may PROPOSE, only a person
-- may RATIFY, and resolution refuses anything not ratified. That split is what
-- makes it safe to let an agent read an authority's tables at all.
--
-- Nothing is seeded. A statutory figure is a fact about the world that has to be
-- read from the authority and confirmed; inventing one here would fabricate the
-- exact evidence a filing depends on.
--
-- @migration-safety: data-safe: every statement below CREATEs new types, a new
-- table, and constraints on that same new table. No pre-existing row is read,
-- altered or constrained, so this cannot fail against any existing data state.
-- Both attribution FKs are ON DELETE SET NULL, so once rows do exist neither can
-- block a person or agent from being deleted.

-- Closed on purpose (AGENTS.md §8): mirrors the PayrollTaxType union the emitter
-- already computes against, so a figure and its computation cannot drift apart
-- on a typo. Deliberately narrower than the spine's free-form
-- TaxRegistration.taxType, which must also carry sales families.
CREATE TYPE "PayrollTaxKind" AS ENUM (
  'federal_withholding', 'social_security', 'medicare', 'additional_medicare',
  'futa', 'state_withholding', 'suta', 'local_withholding'
);
CREATE TYPE "StatutoryRuleStatus" AS ENUM ('proposed', 'ratified', 'rejected', 'superseded');
CREATE TYPE "StatutoryRuleKind" AS ENUM ('rate', 'wage_base', 'threshold', 'amount');

CREATE TABLE "PayrollTaxRule" (
  "id"                TEXT NOT NULL,
  "payrollTaxRuleId"  TEXT NOT NULL,
  "jurisdictionRefId" TEXT NOT NULL,
  "taxType"           "PayrollTaxKind" NOT NULL,
  "ruleKind"          "StatutoryRuleKind" NOT NULL,
  "side"              TEXT,
  "taxYear"           INTEGER NOT NULL,
  "value"             DECIMAL(18,8) NOT NULL,
  "currency"          TEXT,
  "qualifiers"        JSONB NOT NULL DEFAULT '{}',
  "effectiveFrom"     TIMESTAMP(3) NOT NULL,
  "effectiveTo"       TIMESTAMP(3),
  "status"            "StatutoryRuleStatus" NOT NULL DEFAULT 'proposed',
  "sourceUrl"         TEXT,
  "sourceExcerpt"     TEXT,
  "retrievedAt"       TIMESTAMP(3),
  "proposedByAgentId" TEXT,
  "proposedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ratifiedByUserId"  TEXT,
  "ratifiedAt"        TIMESTAMP(3),
  "rejectedReason"    TEXT,
  "notes"             TEXT,
  "lifecycle"         "RecordLifecycle" NOT NULL DEFAULT 'active',
  "lifecycleAt"       TIMESTAMP(3),
  "lifecycleReason"   TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollTaxRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollTaxRule_payrollTaxRuleId_key"
  ON "PayrollTaxRule"("payrollTaxRuleId");
CREATE UNIQUE INDEX "PayrollTaxRule_jur_taxType_ruleKind_side_effectiveFrom_key"
  ON "PayrollTaxRule"("jurisdictionRefId", "taxType", "ruleKind", "side", "effectiveFrom");
CREATE INDEX "PayrollTaxRule_resolve_idx"
  ON "PayrollTaxRule"("jurisdictionRefId", "taxType", "status", "effectiveFrom", "effectiveTo");
CREATE INDEX "PayrollTaxRule_status_proposedAt_idx"
  ON "PayrollTaxRule"("status", "proposedAt");
CREATE INDEX "PayrollTaxRule_proposedByAgentId_idx" ON "PayrollTaxRule"("proposedByAgentId");
CREATE INDEX "PayrollTaxRule_ratifiedByUserId_idx" ON "PayrollTaxRule"("ratifiedByUserId");

ALTER TABLE "PayrollTaxRule"
  ADD CONSTRAINT "PayrollTaxRule_jurisdictionRefId_fkey"
  FOREIGN KEY ("jurisdictionRefId") REFERENCES "TaxJurisdictionReference"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL, not RESTRICT: the attribution is audit context, not ownership. A
-- retired coworker or a departed employee must not pin a statutory figure in
-- place; losing the attribution is the lesser harm.
ALTER TABLE "PayrollTaxRule"
  ADD CONSTRAINT "PayrollTaxRule_proposedByAgentId_fkey"
  FOREIGN KEY ("proposedByAgentId") REFERENCES "Agent"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PayrollTaxRule"
  ADD CONSTRAINT "PayrollTaxRule_ratifiedByUserId_fkey"
  FOREIGN KEY ("ratifiedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
