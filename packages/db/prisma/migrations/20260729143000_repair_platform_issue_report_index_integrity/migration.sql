-- BI-854A9A5C: repair the physically corrupt, duplicate-blocked
-- PlatformIssueReport_dedupeKey_open_key without deleting issue evidence.
--
-- @migration-safety: remediate-before-constraint: every active dedupeKey group
-- is converged under a write-blocking table lock before the partial UNIQUE index
-- is recreated. Compatible recurrence counters are aggregated into the newest
-- report; incompatible rows are retained and suppressed without aggregation.

BEGIN;

LOCK TABLE "PlatformIssueReport" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "PlatformIssueReport"
  ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT,
  ADD COLUMN IF NOT EXISTS "suppressionReason" VARCHAR(80);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"PlatformIssueReport"'::regclass
      AND conname = 'PlatformIssueReport_mergedIntoId_fkey'
  ) THEN
    -- @migration-safety: data-safe: mergedIntoId is a newly added nullable
    -- column and every existing row is null before this self-FK is created.
    ALTER TABLE "PlatformIssueReport"
      ADD CONSTRAINT "PlatformIssueReport_mergedIntoId_fkey"
      FOREIGN KEY ("mergedIntoId")
      REFERENCES "PlatformIssueReport"(id)
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "PlatformIssueReport_mergedIntoId_idx"
  ON "PlatformIssueReport"("mergedIntoId");

-- The damaged unique index can hide committed duplicates from an index scan.
-- Drop both dedupe indexes and force heap-only discovery before classifying data.
DROP INDEX IF EXISTS "PlatformIssueReport_dedupeKey_open_key";
DROP INDEX IF EXISTS "PlatformIssueReport_dedupeKey_idx";

SET LOCAL enable_indexscan = off;
SET LOCAL enable_indexonlyscan = off;
SET LOCAL enable_bitmapscan = off;

CREATE TEMP TABLE "_dpf_pir_repair_map" ON COMMIT DROP AS
WITH active AS (
  SELECT
    report.*,
    row_number() OVER (
      PARTITION BY report."dedupeKey"
      ORDER BY report."createdAt" DESC, report.id DESC
    ) AS survivor_rank,
    count(*) OVER (PARTITION BY report."dedupeKey") AS group_size
  FROM "PlatformIssueReport" report
  WHERE report."dedupeKey" IS NOT NULL
    AND report.status NOT IN (
      'resolved_locally',
      'resolved_upstream',
      'suppressed'
    )
),
compatibility AS (
  SELECT
    "dedupeKey",
    count(DISTINCT ROW(
      type,
      source,
      status,
      "digitalProductId",
      "portfolioId",
      "agentId",
      "featureBuildId",
      "triggerKind",
      "supportSessionId",
      "upstreamIssueNumber"
    )) = 1
      AND sum("occurrenceCount")::bigint BETWEEN -2147483648 AND 2147483647
      AS compatible
  FROM active
  WHERE group_size > 1
  GROUP BY "dedupeKey"
),
survivors AS (
  SELECT id, "dedupeKey"
  FROM active
  WHERE group_size > 1
    AND survivor_rank = 1
)
SELECT
  candidate.id AS "loserId",
  survivor.id AS "survivorId",
  candidate."dedupeKey",
  compatibility.compatible
FROM active candidate
JOIN survivors survivor
  ON survivor."dedupeKey" = candidate."dedupeKey"
JOIN compatibility
  ON compatibility."dedupeKey" = candidate."dedupeKey"
WHERE candidate.group_size > 1
  AND candidate.survivor_rank > 1;

-- Compatible rows are recurrence observations of the same owned issue. Accrue
-- their structured counters into the canonical row without rewriting its title,
-- description, stack, public reportId, ownership, or other diagnostic payload.
WITH compatible_groups AS (
  SELECT DISTINCT "survivorId", "dedupeKey"
  FROM "_dpf_pir_repair_map"
  WHERE compatible
),
aggregates AS (
  SELECT
    group_row."survivorId",
    sum(report."occurrenceCount")::integer AS "occurrenceCount",
    min(coalesce(report."firstSeenAt", report."createdAt")) AS "firstSeenAt",
    max(coalesce(report."lastSeenAt", report."createdAt")) AS "lastSeenAt",
    bool_and(report."stagedUntilPromoted") AS "stagedUntilPromoted",
    (array_agg(
      report.severity
      ORDER BY CASE report.severity
        WHEN 'critical' THEN 4
        WHEN 'high' THEN 3
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 1
        ELSE 0
      END DESC,
      report.severity
    ))[1] AS severity
  FROM compatible_groups group_row
  JOIN "PlatformIssueReport" report
    ON report."dedupeKey" = group_row."dedupeKey"
   AND report.status NOT IN (
     'resolved_locally',
     'resolved_upstream',
     'suppressed'
   )
  GROUP BY group_row."survivorId"
)
UPDATE "PlatformIssueReport" survivor
SET
  "occurrenceCount" = aggregates."occurrenceCount",
  "firstSeenAt" = aggregates."firstSeenAt",
  "lastSeenAt" = aggregates."lastSeenAt",
  "stagedUntilPromoted" = aggregates."stagedUntilPromoted",
  severity = aggregates.severity
FROM aggregates
WHERE survivor.id = aggregates."survivorId";

UPDATE "PlatformIssueReport" loser
SET
  status = 'suppressed',
  "mergedIntoId" = repair."survivorId",
  "suppressionReason" = CASE
    WHEN repair.compatible THEN 'index-repair-duplicate'
    ELSE 'index-repair-incompatible-duplicate'
  END
FROM "_dpf_pir_repair_map" repair
WHERE loser.id = repair."loserId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PlatformIssueReport"
    WHERE "dedupeKey" IS NOT NULL
      AND status NOT IN (
        'resolved_locally',
        'resolved_upstream',
        'suppressed'
      )
    GROUP BY "dedupeKey"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'BI-854A9A5C: active PlatformIssueReport dedupeKey duplicates remain after repair';
  END IF;
END $$;

CREATE INDEX "PlatformIssueReport_dedupeKey_idx"
  ON "PlatformIssueReport"("dedupeKey");

CREATE UNIQUE INDEX "PlatformIssueReport_dedupeKey_open_key"
  ON "PlatformIssueReport"("dedupeKey")
  WHERE "dedupeKey" IS NOT NULL
    AND "status" NOT IN (
      'resolved_locally',
      'resolved_upstream',
      'suppressed'
    );

CREATE EXTENSION IF NOT EXISTS amcheck;

DO $$
DECLARE
  index_name text;
  index_flags record;
  check_result text;
BEGIN
  FOREACH index_name IN ARRAY ARRAY[
    'PlatformIssueReport_dedupeKey_idx',
    'PlatformIssueReport_dedupeKey_open_key'
  ]
  LOOP
    SELECT i.indisvalid, i.indisready, i.indislive
    INTO index_flags
    FROM pg_index i
    WHERE i.indexrelid =
      format('%I.%I', current_schema(), index_name)::regclass;

    IF NOT (
      index_flags.indisvalid
      AND index_flags.indisready
      AND index_flags.indislive
    ) THEN
      RAISE EXCEPTION
        'BI-854A9A5C: index % is not valid, ready, and live',
        index_name;
    END IF;

    SELECT public.bt_index_parent_check(
      format('%I.%I', current_schema(), index_name)::regclass,
      true,
      true
    )::text
    INTO check_result;
  END LOOP;
END $$;

COMMIT;
