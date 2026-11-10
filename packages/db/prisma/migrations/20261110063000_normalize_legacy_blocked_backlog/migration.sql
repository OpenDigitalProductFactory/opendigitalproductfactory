-- BI-22CDF13B / DI-FB8D23E524B1: contract BacklogItem.status by preserving
-- historical `blocked` work as attributable, reviewable deferrals.
-- @migration-safety: data-safe: the migration changes only rows carrying the
-- non-canonical legacy value `blocked`, preserves every item and its history,
-- refuses to proceed when no active human can own a deferral, validates the
-- narrowed closed set. The later Prisma-client enum conversion remains with
-- the parent enum-contract program because it changes mapped API literals.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE "BacklogItem" IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE "_BacklogBlockedNormalization" AS
SELECT
  bi.id AS "backlogItemId",
  COALESCE(
    (
      SELECT p.id
      FROM "PrincipalAlias" pa
      JOIN "Principal" p ON p.id = pa."principalId"
      JOIN "User" u ON u.id = pa."aliasValue"
      WHERE pa."aliasType" = 'user'
        AND pa."aliasValue" = bi."submittedById"
        AND p.kind = 'human'
        AND p.status = 'active'
        AND u."isActive" = true
      ORDER BY pa.id
      LIMIT 1
    ),
    (
      SELECT p.id
      FROM "Portfolio" portfolio
      JOIN "Principal" p ON p.id = portfolio."accountablePrincipalId"
      JOIN "PrincipalAlias" pa ON pa."principalId" = p.id AND pa."aliasType" = 'user'
      JOIN "User" u ON u.id = pa."aliasValue"
      WHERE portfolio.slug = 'foundational'
        AND p.kind = 'human'
        AND p.status = 'active'
        AND u."isActive" = true
      ORDER BY pa.id
      LIMIT 1
    ),
    (
      SELECT p.id
      FROM "Organization" organization
      JOIN "Principal" p ON p.id = organization."topAccountablePrincipalId"
      JOIN "PrincipalAlias" pa ON pa."principalId" = p.id AND pa."aliasType" = 'user'
      JOIN "User" u ON u.id = pa."aliasValue"
      WHERE p.kind = 'human'
        AND p.status = 'active'
        AND u."isActive" = true
      ORDER BY organization."createdAt", pa.id
      LIMIT 1
    ),
    (
      SELECT p.id
      FROM "User" u
      JOIN "PrincipalAlias" pa ON pa."aliasType" = 'user' AND pa."aliasValue" = u.id
      JOIN "Principal" p ON p.id = pa."principalId"
      WHERE u."isSuperuser" = true
        AND u."isActive" = true
        AND p.kind = 'human'
        AND p.status = 'active'
      ORDER BY (u."workHandedOverAt" IS NULL) DESC, u."createdAt", pa.id
      LIMIT 1
    )
  ) AS "ownerPrincipalId"
FROM "BacklogItem" bi
WHERE bi.status = 'blocked';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "_BacklogBlockedNormalization"
    WHERE "ownerPrincipalId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot normalize legacy blocked backlog: no active human deferral owner is available';
  END IF;
END $$;

INSERT INTO "BacklogItemActivity" ("id", "backlogItemId", "kind", "summary", "payload", "recordedAt")
SELECT
  'blocked_to_deferred_' || md5(bi.id),
  bi.id,
  'status_change',
  'blocked → deferred — legacy lifecycle normalized (BI-22CDF13B)',
  jsonb_build_object(
    'from', 'blocked',
    'to', 'deferred',
    'reason', 'Legacy blocked status normalized into the governed deferral lifecycle (BI-22CDF13B)',
    'actuator', 'migration:20261110063000_normalize_legacy_blocked_backlog',
    'decisionInteractionId', 'DI-FB8D23E524B1',
    'deferral', jsonb_build_object(
      'reason', 'This item carried the legacy blocked status without attributable blocker metadata; it remains wanted and must be reviewed before resumption.',
      'trigger', 'The accountable backlog owner reviews the item and either records its actionable dependency or resumes it with current scope and evidence.',
      'reviewAt', (CURRENT_TIMESTAMP + INTERVAL '90 days'),
      'ownerPrincipalId', normalization."ownerPrincipalId"
    )
  ),
  CURRENT_TIMESTAMP
FROM "_BacklogBlockedNormalization" normalization
JOIN "BacklogItem" bi ON bi.id = normalization."backlogItemId"
WHERE NOT EXISTS (
  SELECT 1
  FROM "BacklogItemActivity" existing
  WHERE existing.id = 'blocked_to_deferred_' || md5(bi.id)
);

UPDATE "BacklogItem" bi
SET
  status = 'deferred',
  "deferReason" = 'This item carried the legacy blocked status without attributable blocker metadata; it remains wanted and must be reviewed before resumption.',
  "deferTrigger" = 'The accountable backlog owner reviews the item and either records its actionable dependency or resumes it with current scope and evidence.',
  "deferReviewAt" = CURRENT_TIMESTAMP + INTERVAL '90 days',
  "deferOwnerPrincipalId" = normalization."ownerPrincipalId",
  "deferredAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_BacklogBlockedNormalization" normalization
WHERE bi.id = normalization."backlogItemId"
  AND bi.status = 'blocked';

ALTER TABLE "BacklogItem" DROP CONSTRAINT IF EXISTS "BacklogItem_status_closed_set";
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_status_closed_set"
  CHECK (status IN (
    'triaging',
    'open',
    'in-progress',
    'awaiting-acceptance',
    'done',
    'deferred',
    'retired'
  )) NOT VALID;
ALTER TABLE "BacklogItem" VALIDATE CONSTRAINT "BacklogItem_status_closed_set";

DROP TABLE "_BacklogBlockedNormalization";
COMMIT;
