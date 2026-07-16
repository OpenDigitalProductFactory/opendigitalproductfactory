-- BI-51F6A428 (reach-threshold + staging gate before a log signature becomes a
-- backlog item): accrual + staging columns on PlatformIssueReport. A reach-gated
-- automated signal (the log-signature "noise-digest" stream) is held
-- `stagedUntilPromoted` and accrues occurrenceCount/lastSeenAt across scan
-- windows instead of minting a BI-PIR-* on first sight. The triage path projects
-- it only once it crosses the reach+recency bar, and ages out genuinely-stopped
-- one-offs (status→suppressed) with no BI. High/critical signals bypass the gate
-- and project on first occurrence. Resolver:
-- apps/web/lib/quality/issue-report-promotion.ts.
--
-- @migration-safety: data-safe: occurrenceCount and stagedUntilPromoted are NOT
-- NULL but carry table-level DEFAULTs, so Postgres backfills every existing row
-- without a rewrite and no pre-existing row can violate the columns.
-- firstSeenAt/lastSeenAt are nullable and backfilled from createdAt below. No
-- new constraints, uniques, or indexes are tightened over existing data.
ALTER TABLE "PlatformIssueReport"
    ADD COLUMN "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "firstSeenAt" TIMESTAMP(3),
    ADD COLUMN "lastSeenAt" TIMESTAMP(3),
    ADD COLUMN "stagedUntilPromoted" BOOLEAN NOT NULL DEFAULT false;

-- Backfill sighting timestamps for existing rows: treat their creation as the
-- first and last sighting so the promotion math has a basis if a legacy row is
-- ever re-evaluated. Existing rows are already projected/triaged and are not
-- staged, so none can be re-minted by this change.
UPDATE "PlatformIssueReport"
    SET "firstSeenAt" = "createdAt", "lastSeenAt" = "createdAt"
    WHERE "firstSeenAt" IS NULL;
