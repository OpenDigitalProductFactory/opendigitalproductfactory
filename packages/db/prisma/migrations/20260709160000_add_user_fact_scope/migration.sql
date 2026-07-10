-- BI-1772D0B7 (EP-8C706944 P4): two-scope memory columns on UserFact.
-- Additive with defaults — every existing fact becomes scope=user / sensitivity=normal
-- (its current private behavior), so no existing row can violate this.
-- @migration-safety: data-safe: both columns have a DEFAULT, so existing rows are backfilled to the current (private) behavior.
ALTER TABLE "UserFact" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "UserFact" ADD COLUMN "sensitivity" TEXT NOT NULL DEFAULT 'normal';
CREATE INDEX "UserFact_scope_sensitivity_supersededAt_idx" ON "UserFact"("scope", "sensitivity", "supersededAt");
