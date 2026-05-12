-- Retrofit Principal convergence onto EdgeNode per AGENTS.md §11.
--
-- The Phase 0 schema in migration 20260512000000_add_edge_node_phase0
-- shipped EdgeNode as a parallel identity table with `displayName`
-- directly on it. AGENTS.md §11 (Principal convergence, 2026-05-09)
-- explicitly names EdgeNode as a convergence target: identity must
-- live on Principal + PrincipalAlias, with EdgeNode as a
-- host-attributes side table keyed 1:1 to Principal via principalId.
--
-- This migration:
--   1. Adds EdgeNode.principalId as nullable
--   2. Backfills it from existing PrincipalAlias rows (which PR #498's
--      enrollment code already creates) where possible
--   3. For any orphaned EdgeNode rows (no matching alias), creates
--      Principal + PrincipalAlias rows so the relationship is complete
--   4. Promotes principalId to NOT NULL with unique + FK constraints
--   5. Drops EdgeNode.displayName (identity-bearing data lives on Principal)
--
-- All steps are idempotent: re-running on an empty EdgeNode table is a
-- no-op (no rows to migrate); re-running after partial migration would
-- catch only the un-migrated rows.

-- Step 1: Add principalId column as nullable so backfill can populate it.
ALTER TABLE "EdgeNode" ADD COLUMN "principalId" TEXT;

-- Step 2: For EdgeNode rows that have NO matching PrincipalAlias of
-- aliasType="edge_node" yet (i.e. rows pre-dating PR #498's
-- enrollment code, or rows created through a path that bypassed it),
-- create a Principal of kind="edge_node" first. Deterministic
-- principalId so re-running this migration is a no-op via the
-- ON CONFLICT clause.
--
-- The value "edge_node" (underscore, not hyphen) is the canonical
-- form. It matches packages/db/src/edge-node-types.ts:
-- EDGE_NODE_ALIAS_KIND = "edge_node" and the existing aliasType
-- convention in packages/db/prisma/schema.prisma (user, employee,
-- agent, gaid, customer_contact — single words or underscores).
-- The Edge Node spec uses "edge-node" in its example schema comments;
-- that's a doc-only inconsistency tracked in a follow-up.
INSERT INTO "Principal" (id, "principalId", kind, status, "displayName", "createdAt", "updatedAt")
SELECT
  'edge-principal-' || e.id,
  'PRN-EDGE-' || e."nodeId",
  'edge_node',
  CASE WHEN e."trustState" = 'revoked' THEN 'inactive' ELSE 'active' END,
  e."displayName",
  e."createdAt",
  e."updatedAt"
FROM "EdgeNode" e
LEFT JOIN "PrincipalAlias" pa
  ON pa."aliasType" = 'edge_node' AND pa."aliasValue" = e."nodeId"
WHERE pa.id IS NULL
ON CONFLICT ("principalId") DO NOTHING;

-- Step 3: For EdgeNode rows that have NO matching PrincipalAlias yet,
-- create one. We just inserted the Principal in step 2; this insert
-- creates the alias linking that Principal to the nodeId.
INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
SELECT
  'edge-alias-' || e.id,
  p.id,
  'edge_node',
  e."nodeId",
  '',
  NOW()
FROM "EdgeNode" e
JOIN "Principal" p ON p."principalId" = 'PRN-EDGE-' || e."nodeId"
LEFT JOIN "PrincipalAlias" pa
  ON pa."aliasType" = 'edge_node' AND pa."aliasValue" = e."nodeId"
WHERE pa.id IS NULL
ON CONFLICT ("aliasType", "aliasValue", issuer) DO NOTHING;

-- Step 4: Populate EdgeNode.principalId from the joined Principal via
-- the alias. Every EdgeNode now has a matching alias (either created
-- by PR #498's enrollment code, or by step 3 above for orphans).
UPDATE "EdgeNode" AS e
SET "principalId" = pa."principalId"
FROM "PrincipalAlias" AS pa
WHERE pa."aliasType" = 'edge_node'
  AND pa."aliasValue" = e."nodeId"
  AND e."principalId" IS NULL;

-- Step 5: principalId is now backfilled for every row. Promote to NOT
-- NULL and add the unique constraint that enforces 1:1 cardinality.
ALTER TABLE "EdgeNode" ALTER COLUMN "principalId" SET NOT NULL;
CREATE UNIQUE INDEX "EdgeNode_principalId_key" ON "EdgeNode"("principalId");

-- Step 6: Add the foreign key. ON DELETE CASCADE because deleting the
-- Principal means revoking the Edge Node's identity entirely.
ALTER TABLE "EdgeNode"
  ADD CONSTRAINT "EdgeNode_principalId_fkey"
  FOREIGN KEY ("principalId") REFERENCES "Principal"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 7: Drop the duplicate displayName column. From here on, callers
-- read displayName from EdgeNode.principal.displayName via the Prisma
-- relation. Anyone still selecting EdgeNode.displayName fails fast at
-- typecheck time after this migration applies.
ALTER TABLE "EdgeNode" DROP COLUMN "displayName";
