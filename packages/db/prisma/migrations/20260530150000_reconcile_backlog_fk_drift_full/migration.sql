-- Comprehensive completion of the BacklogItem NOT VALID FK drift reconciliation
-- (BI-4B5EE23E / BI-0B91EF1C). The first pass (20260530030000) cleaned only
-- accountableEmployeeId; promotion then tripped the NEXT orphaned FK in turn
-- (submittedById, etc.). This pass nulls ALL remaining orphaned BacklogItem FK
-- references and validates every BacklogItem FK so promote_to_build_studio's
-- backlogItem.update() can't be blocked by a stale legacy reference again.
--
-- Cause: this install's backlog was imported with references (users, employees,
-- builds, products, taxonomy) that don't exist in its own tables. The NOT VALID
-- constraints let the dangling refs persist. All columns are nullable + ON
-- DELETE SET NULL, so NULL is a valid resting state; the platform repopulates
-- real owners/builds as work proceeds.
--
-- Orphan counts measured before authoring (so the validated re-add can't fail):
--   submittedById->User: 681 | activeBuildId->FeatureBuild: 9
--   digitalProductId->DigitalProduct: 2 | taxonomyNodeId->TaxonomyNode: 2
--   activeEpicId/epicId/claimedById/claimedByAgentId/duplicateOfId/accountableEmployeeId: 0
-- VALIDATE on an already-valid constraint is a no-op (safe/idempotent on
-- installs that never drifted).

UPDATE "BacklogItem" b SET "submittedById" = NULL
  WHERE "submittedById" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = b."submittedById");
UPDATE "BacklogItem" b SET "activeBuildId" = NULL
  WHERE "activeBuildId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "FeatureBuild" f WHERE f.id = b."activeBuildId");
UPDATE "BacklogItem" b SET "digitalProductId" = NULL
  WHERE "digitalProductId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "DigitalProduct" d WHERE d.id = b."digitalProductId");
UPDATE "BacklogItem" b SET "taxonomyNodeId" = NULL
  WHERE "taxonomyNodeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "TaxonomyNode" t WHERE t.id = b."taxonomyNodeId");

ALTER TABLE "BacklogItem" VALIDATE CONSTRAINT "BacklogItem_submittedById_fkey";
ALTER TABLE "BacklogItem" VALIDATE CONSTRAINT "BacklogItem_activeBuildId_fkey";
ALTER TABLE "BacklogItem" VALIDATE CONSTRAINT "BacklogItem_activeEpicId_fkey";
ALTER TABLE "BacklogItem" VALIDATE CONSTRAINT "BacklogItem_epicId_fkey";
ALTER TABLE "BacklogItem" VALIDATE CONSTRAINT "BacklogItem_digitalProductId_fkey";
ALTER TABLE "BacklogItem" VALIDATE CONSTRAINT "BacklogItem_taxonomyNodeId_fkey";
