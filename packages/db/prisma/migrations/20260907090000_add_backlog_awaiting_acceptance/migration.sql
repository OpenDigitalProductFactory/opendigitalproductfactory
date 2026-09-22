-- BI-7161625D: coding close-out is awaiting-acceptance at PR submit.
-- Column remains String; Prisma enum + CHECK are the closed set.
-- Legacy 'blocked' stays in the CHECK (live historical rows).

ALTER TYPE "BacklogItemStatus" ADD VALUE IF NOT EXISTS 'awaiting-acceptance';

ALTER TABLE "BacklogItem" DROP CONSTRAINT IF EXISTS "BacklogItem_status_closed_set";
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_status_closed_set"
  CHECK ("status" IN (
    'triaging',
    'open',
    'in-progress',
    'awaiting-acceptance',
    'done',
    'deferred',
    'retired',
    'blocked'
  )) NOT VALID;
ALTER TABLE "BacklogItem" VALIDATE CONSTRAINT "BacklogItem_status_closed_set";

-- Activity first so the payload records the prior coding-pool status.
INSERT INTO "BacklogItemActivity" ("id", "backlogItemId", "kind", "summary", "payload", "recordedAt")
SELECT
  'baa_pr_submit_' || bi.id,
  bi.id,
  'status_change',
  bi.status || ' → awaiting-acceptance — existing PR observed (BI-7161625D)',
  jsonb_build_object(
    'from', bi.status,
    'to', 'awaiting-acceptance',
    'reason', 'Existing pull request observed at awaiting-acceptance rollout',
    'actuator', 'pr-submit-backfill'
  ),
  NOW()
FROM "BacklogItem" bi
WHERE bi.status IN ('triaging', 'open', 'in-progress')
  AND (
    EXISTS (
      SELECT 1
      FROM "WorkCapsule" w
      WHERE w."pullRequestNumber" IS NOT NULL
        AND (w."backlogItemId" = bi."itemId" OR w."backlogItemId" = bi.id)
    )
    OR EXISTS (
      SELECT 1
      FROM "BacklogItemActivity" a
      WHERE a."backlogItemId" = bi.id
        AND a.kind = 'evidence'
        AND a.payload::text ~ '/pull/[0-9]+'
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM "BacklogItemActivity" existing
    WHERE existing.id = 'baa_pr_submit_' || bi.id
  );

UPDATE "BacklogItem" AS bi
SET
  status = 'awaiting-acceptance',
  "claimStatus" = CASE WHEN bi."claimStatus" = 'active' THEN 'released' ELSE bi."claimStatus" END,
  "claimedById" = CASE WHEN bi."claimStatus" = 'active' THEN NULL ELSE bi."claimedById" END,
  "claimedByAgentId" = CASE WHEN bi."claimStatus" = 'active' THEN NULL ELSE bi."claimedByAgentId" END,
  "claimedAt" = CASE WHEN bi."claimStatus" = 'active' THEN NULL ELSE bi."claimedAt" END,
  "updatedAt" = NOW()
WHERE bi.status IN ('triaging', 'open', 'in-progress')
  AND (
    EXISTS (
      SELECT 1
      FROM "WorkCapsule" w
      WHERE w."pullRequestNumber" IS NOT NULL
        AND (w."backlogItemId" = bi."itemId" OR w."backlogItemId" = bi.id)
    )
    OR EXISTS (
      SELECT 1
      FROM "BacklogItemActivity" a
      WHERE a."backlogItemId" = bi.id
        AND a.kind = 'evidence'
        AND a.payload::text ~ '/pull/[0-9]+'
    )
  );
