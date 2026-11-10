-- Organization.topAccountablePrincipalId — the human who answers for the
-- organization's outcomes (BI-571093CC, requirement PWA-04).
--
-- Nullable on purpose. An organization with no recorded owner must read as
-- unset so the product can ask for it. Deriving one from the first
-- administrator, the install's creator, or a lease holder would present a guess
-- as a decision somebody made, and accountability inherits from this root.

ALTER TABLE "Organization" ADD COLUMN "topAccountablePrincipalId" TEXT;

-- @migration-safety: data-safe: the column is added by the statement above and is
-- NULL on every existing row at this point, so no existing row can violate the
-- foreign key. The backfill below runs after and can only write ids selected by
-- an inner join against "Principal", so it cannot introduce a dangling reference
-- either.
ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_topAccountablePrincipalId_fkey"
  FOREIGN KEY ("topAccountablePrincipalId") REFERENCES "Principal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Organization_topAccountablePrincipalId_idx"
  ON "Organization"("topAccountablePrincipalId");

-- Inline backfill, deliberately narrow.
--
-- The only recorded link between an install's first human and its organization
-- is PlatformSetupProgress: the person who completed setup. Resolve that user to
-- a Principal through the canonical "user" alias and record it as the owner.
--
-- Every clause here exists to avoid writing a guess:
--   • only when the organization has no owner already;
--   • only when setup names exactly one user for that organization;
--   • only when that user resolves to exactly one active human Principal
--     (an ambiguous alias leaves the column null for an operator to settle);
--   • an install with no setup record, or a still-incomplete one, is left null.
--
-- An install that gets nothing from this migration is not broken. It reads as
-- "no owner recorded", which is the honest state and is what the product asks
-- the operator to correct.
UPDATE "Organization" o
SET "topAccountablePrincipalId" = resolved.principal_id
FROM (
  SELECT
    sp."organizationId" AS organization_id,
    MIN(p."id")         AS principal_id
  FROM "PlatformSetupProgress" sp
  JOIN "PrincipalAlias" pa
    ON pa."aliasType" = 'user'
   AND pa."aliasValue" = sp."userId"
  JOIN "Principal" p
    ON p."id" = pa."principalId"
   AND p."kind" = 'human'
   AND p."status" = 'active'
  WHERE sp."organizationId" IS NOT NULL
    AND sp."userId" IS NOT NULL
  GROUP BY sp."organizationId"
  HAVING COUNT(DISTINCT p."id") = 1
) AS resolved
WHERE o."id" = resolved.organization_id
  AND o."topAccountablePrincipalId" IS NULL;
