-- Corrective (drift-repair) migration.
--
-- schema.prisma and the original 20260424173000_backlog_governed_delivery
-- migration both define FeatureBuild.originatingBacklogItemId as a FK to
-- BacklogItem("id") (the cuid). On at least one install the LIVE constraint
-- had drifted to reference BacklogItem("itemId") (the semantic BI-* id) and
-- was marked NOT VALID — so promote_to_build_studio failed with
--   "Foreign key constraint violated: FeatureBuild_originatingBacklogItemId_fkey"
-- because the promote path writes the BacklogItem cuid (item.id) into
-- originatingBacklogItemId (see apps/web/lib/governed-backlog-tee-up.ts and
-- apps/web/lib/integrate/ideate-on-approval.ts, which both treat it as a
-- BacklogItem.id). Every Build Studio promotion was blocked as a result.
--
-- This reconciles the live constraint back to the committed definition. It is
-- idempotent (DROP IF EXISTS) and safe to apply where the FK is already
-- correct. FeatureBuild has no rows with originatingBacklogItemId set on the
-- affected install, so the re-validated ADD cannot fail on existing data.
--
-- The broader drift (all BacklogItem FKs recreated NOT VALID, and
-- BusinessCapabilityTraceLink.backlogItemId also drifted to itemId) is tracked
-- separately for investigation + data cleanup before its FK can be corrected.

ALTER TABLE "FeatureBuild" DROP CONSTRAINT IF EXISTS "FeatureBuild_originatingBacklogItemId_fkey";
ALTER TABLE "FeatureBuild" ADD CONSTRAINT "FeatureBuild_originatingBacklogItemId_fkey" FOREIGN KEY ("originatingBacklogItemId") REFERENCES "BacklogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
