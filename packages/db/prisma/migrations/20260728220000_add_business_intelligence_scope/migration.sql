-- Phase 7 expands the existing research, battlecard, and scheduler authorities
-- with explicit business ProductLine/Product scope. No existing row is
-- reclassified: nullable fields preserve organization-wide research and
-- battlecards, while existing scheduled tasks remain outside product context.
--
-- @migration-safety: data-safe: every added column is nullable and starts NULL;
-- therefore existing rows satisfy the mutual-exclusion checks and cannot
-- violate the new foreign keys. No scope is inferred or backfilled.
ALTER TABLE "ResearchProposal"
  ADD COLUMN "productLineId" TEXT,
  ADD COLUMN "businessProductId" TEXT;

ALTER TABLE "MarketingBattlecard"
  ADD COLUMN "productLineId" TEXT,
  ADD COLUMN "businessProductId" TEXT;

ALTER TABLE "ScheduledAgentTask"
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "productLineId" TEXT,
  ADD COLUMN "businessProductId" TEXT,
  ADD COLUMN "taskKind" TEXT,
  ADD COLUMN "taskConfig" JSONB;

CREATE INDEX "ResearchProposal_productLineId_idx"
  ON "ResearchProposal"("productLineId");
CREATE INDEX "ResearchProposal_businessProductId_idx"
  ON "ResearchProposal"("businessProductId");
CREATE INDEX "MarketingBattlecard_productLineId_idx"
  ON "MarketingBattlecard"("productLineId");
CREATE INDEX "MarketingBattlecard_businessProductId_idx"
  ON "MarketingBattlecard"("businessProductId");
CREATE INDEX "ScheduledAgentTask_organizationId_idx"
  ON "ScheduledAgentTask"("organizationId");
CREATE INDEX "ScheduledAgentTask_productLineId_idx"
  ON "ScheduledAgentTask"("productLineId");
CREATE INDEX "ScheduledAgentTask_businessProductId_idx"
  ON "ScheduledAgentTask"("businessProductId");
CREATE INDEX "ScheduledAgentTask_taskKind_isActive_nextRunAt_idx"
  ON "ScheduledAgentTask"("taskKind", "isActive", "nextRunAt");

-- One evidence record has one narrower semantic target. DigitalProduct remains
-- an architecture boundary and is never combined with a business target.
ALTER TABLE "ResearchProposal"
  ADD CONSTRAINT "ResearchProposal_one_narrower_scope_check"
  CHECK (num_nonnulls("productLineId", "businessProductId", "digitalProductId") <= 1);

ALTER TABLE "MarketingBattlecard"
  ADD CONSTRAINT "MarketingBattlecard_one_narrower_scope_check"
  CHECK (num_nonnulls("productLineId", "businessProductId", "digitalProductId") <= 1);

ALTER TABLE "ScheduledAgentTask"
  ADD CONSTRAINT "ScheduledAgentTask_one_business_scope_check"
  CHECK (num_nonnulls("productLineId", "businessProductId") <= 1),
  ADD CONSTRAINT "ScheduledAgentTask_scoped_task_has_org_check"
  CHECK (
    ("productLineId" IS NULL AND "businessProductId" IS NULL)
    OR "organizationId" IS NOT NULL
  );

ALTER TABLE "ResearchProposal"
  ADD CONSTRAINT "ResearchProposal_productLineId_organizationId_fkey"
  FOREIGN KEY ("productLineId", "organizationId")
  REFERENCES "ProductLine"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ResearchProposal_businessProductId_organizationId_fkey"
  FOREIGN KEY ("businessProductId", "organizationId")
  REFERENCES "Product"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MarketingBattlecard"
  ADD CONSTRAINT "MarketingBattlecard_productLineId_organizationId_fkey"
  FOREIGN KEY ("productLineId", "organizationId")
  REFERENCES "ProductLine"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MarketingBattlecard_businessProductId_organizationId_fkey"
  FOREIGN KEY ("businessProductId", "organizationId")
  REFERENCES "Product"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduledAgentTask"
  ADD CONSTRAINT "ScheduledAgentTask_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ScheduledAgentTask_productLineId_organizationId_fkey"
  FOREIGN KEY ("productLineId", "organizationId")
  REFERENCES "ProductLine"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ScheduledAgentTask_businessProductId_organizationId_fkey"
  FOREIGN KEY ("businessProductId", "organizationId")
  REFERENCES "Product"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
