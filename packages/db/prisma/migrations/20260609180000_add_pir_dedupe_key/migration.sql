-- BI-5FE8656F (EP-FULL-OBS Tier 2): dedupeKey on PlatformIssueReport.
-- Additive, nullable column — existing rows are unaffected. Automated
-- producers (the log-signature scanner) write `log-sig:<service>:<sigId>` so
-- the same recurring signature is filed once, not every 15-minute cycle.
ALTER TABLE "PlatformIssueReport" ADD COLUMN "dedupeKey" TEXT;

-- Lookup index for the scanner's idempotency check.
CREATE INDEX "PlatformIssueReport_dedupeKey_idx" ON "PlatformIssueReport"("dedupeKey");

-- Partial UNIQUE index: enforce ONE non-resolved report per dedupeKey while
-- leaving resolved/suppressed rows free, so a recurrence after resolution can
-- re-file. Prisma cannot express partial-unique predicates, so this lives here
-- as raw SQL. The predicate uses only immutable constants (a literal status
-- list), which Postgres requires for index predicates. NULL dedupeKey rows
-- (every non-scanner producer) are excluded and so are never constrained.
CREATE UNIQUE INDEX "PlatformIssueReport_dedupeKey_open_key"
  ON "PlatformIssueReport"("dedupeKey")
  WHERE "dedupeKey" IS NOT NULL
    AND "status" NOT IN ('resolved_locally', 'resolved_upstream', 'suppressed');
