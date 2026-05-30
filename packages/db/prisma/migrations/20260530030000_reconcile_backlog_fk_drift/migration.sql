-- Data-reconciliation migration for the systemic NOT VALID FK drift on
-- BacklogItem-related foreign keys (BI-0B91EF1C, BI-4B5EE23E).
--
-- Background: on at least one install every BacklogItem FK was left NOT VALID
-- (the committed migrations create them validated), which let dangling
-- references accumulate. Most visibly, 502 BacklogItem rows carried an
-- accountableEmployeeId pointing at an EmployeeProfile row that does not exist
-- on the install — so promote_to_build_studio's backlogItem.update() tripped
-- BacklogItem_accountableEmployeeId_fkey and blocked ALL Build Studio
-- promotion. This migration cleans the orphans and flips the constraints back
-- to enforced so the integrity gap can't recur.
--
-- Safety: orphan counts were measured before authoring — only
-- accountableEmployeeId had orphans (502); all other referencing data is clean
-- and BusinessCapabilityTraceLink is empty. Each step is therefore guaranteed
-- to apply. VALIDATE CONSTRAINT on an already-valid constraint is a no-op, so
-- this is safe/idempotent on installs that never drifted.

-- 1) Null orphaned accountable-employee anchors (referenced EmployeeProfile
--    rows that don't exist here). accountableEmployeeId is nullable and the FK
--    is ON DELETE SET NULL, so NULL is a valid resting state; promotion
--    reassigns a real owner.
UPDATE "BacklogItem" b
SET "accountableEmployeeId" = NULL
WHERE "accountableEmployeeId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "EmployeeProfile" e WHERE e.id = b."accountableEmployeeId");

-- 2) Correct the BusinessCapabilityTraceLink column drift: the live constraint
--    referenced BacklogItem("itemId"); schema.prisma:5615 says BacklogItem("id").
--    Table is empty on the affected install, so the re-add is safe + validated.
ALTER TABLE "BusinessCapabilityTraceLink" DROP CONSTRAINT IF EXISTS "BusinessCapabilityTraceLink_backlogItemId_fkey";
ALTER TABLE "BusinessCapabilityTraceLink" ADD CONSTRAINT "BusinessCapabilityTraceLink_backlogItemId_fkey"
  FOREIGN KEY ("backlogItemId") REFERENCES "BacklogItem"("id") ON UPDATE CASCADE ON DELETE CASCADE;

-- 3) Enforce the previously-NOT-VALID FKs (referencing data is now clean).
--    Each already references the correct column; VALIDATE flips it to enforced.
ALTER TABLE "BacklogItem" VALIDATE CONSTRAINT "BacklogItem_accountableEmployeeId_fkey";
ALTER TABLE "BacklogItem" VALIDATE CONSTRAINT "BacklogItem_duplicateOfId_fkey";
ALTER TABLE "Epic" VALIDATE CONSTRAINT "Epic_originatingBacklogItemId_fkey";
ALTER TABLE "BacklogItemActivity" VALIDATE CONSTRAINT "BacklogItemActivity_backlogItemId_fkey";
ALTER TABLE "CoworkerCapabilityNeed" VALIDATE CONSTRAINT "CoworkerCapabilityNeed_linkedBacklogItemId_fkey";
