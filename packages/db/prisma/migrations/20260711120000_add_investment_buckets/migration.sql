-- EP-DEMAND-MGMT Phase 3: investment-bucket (run|grow|transform) strategic-balance
-- axis on BacklogItem + Epic, and a per-portfolio target allocation.
-- @migration-safety: data-safe: all columns are nullable additions; no existing
-- row can violate any constraint.
ALTER TABLE "BacklogItem" ADD COLUMN "investmentBucket" TEXT;
ALTER TABLE "Epic" ADD COLUMN "investmentBucket" TEXT;
ALTER TABLE "Portfolio" ADD COLUMN "bucketTargets" JSONB;
