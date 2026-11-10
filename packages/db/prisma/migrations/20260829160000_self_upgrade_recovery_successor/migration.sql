-- BI-3FD07259: terminal self-upgrade admissions remain immutable history.
-- A nullable, unique self-reference records the one separately fingerprinted
-- successor admitted to recover from a terminal predecessor. Historical rows
-- intentionally remain NULL; no target, status, or failure evidence is changed.

ALTER TABLE "SelfUpgradeRun"
  ADD COLUMN "recoveryOfRunId" TEXT;

-- @migration-safety: data-safe: recoveryOfRunId is a newly added nullable column, so every existing row is non-conflicting; the only backfill value is a unique link to an existing SelfUpgradeRun selected below.
CREATE UNIQUE INDEX "SelfUpgradeRun_recoveryOfRunId_key"
  ON "SelfUpgradeRun"("recoveryOfRunId");

ALTER TABLE "SelfUpgradeRun"
  ADD CONSTRAINT "SelfUpgradeRun_recoveryOfRunId_fkey"
  FOREIGN KEY ("recoveryOfRunId") REFERENCES "SelfUpgradeRun"("runId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Source-free bootstrap ordering: this audit-only relation grants no dispatch
-- authority. This migration is first executed by the new
-- container after the previous runtime has admitted and dispatched the one
-- authenticated operator action. Link only that singular in-flight admission
-- to the immediately preceding pre-dispatch terminal failure. Every predicate
-- is structurally fail-closed: no active ambiguity, no untagged/Git target, no same-target
-- retry, no prior dispatch acknowledgement, and no existing successor.
WITH "active_count" AS (
  SELECT COUNT(*)::INTEGER AS "count"
  FROM "SelfUpgradeRun"
  WHERE "status" IN ('pending', 'queued', 'running')
),
"candidate" AS (
  SELECT
    "successor"."id" AS "successorId",
    "predecessor"."runId" AS "predecessorRunId"
  FROM "SelfUpgradeRun" AS "successor"
  CROSS JOIN "active_count"
  JOIN LATERAL (
    SELECT "prior".*
    FROM "SelfUpgradeRun" AS "prior"
    WHERE "prior"."createdAt" < "successor"."createdAt"
    ORDER BY "prior"."createdAt" DESC
    LIMIT 1
  ) AS "predecessor" ON TRUE
  WHERE "active_count"."count" = 1
    AND "successor"."status" IN ('pending', 'queued', 'running')
    AND "successor"."completedAt" IS NULL
    AND "successor"."trigger" LIKE 'manual:%'
    AND "successor"."targetTag" IS NOT NULL
    AND "successor"."admissionFingerprint" IS NOT NULL
    AND "successor"."dispatchStatus" IN ('dispatching', 'dispatched')
    AND "predecessor"."status" = 'failed'
    AND "predecessor"."completedAt" IS NOT NULL
    AND "predecessor"."dispatchAttemptCount" = 0
    AND "predecessor"."admissionFingerprint" IS NOT NULL
    AND "predecessor"."dispatchStatus" IS NOT NULL
    AND "predecessor"."dispatchAcknowledgedAt" IS NULL
    AND cardinality("predecessor"."dispatchEventIds") = 0
    AND "predecessor"."targetSha" IS NOT NULL
    AND "predecessor"."targetTag" IS NOT NULL
    AND LOWER("predecessor"."targetSha") <> LOWER("successor"."targetSha")
    AND "predecessor"."targetTag" <> "successor"."targetTag"
    AND NOT EXISTS (
      SELECT 1
      FROM "SelfUpgradeRun" AS "existing"
      WHERE "existing"."recoveryOfRunId" = "predecessor"."runId"
    )
)
UPDATE "SelfUpgradeRun" AS "successor"
SET "recoveryOfRunId" = "candidate"."predecessorRunId"
FROM "candidate"
WHERE "successor"."id" = "candidate"."successorId";
