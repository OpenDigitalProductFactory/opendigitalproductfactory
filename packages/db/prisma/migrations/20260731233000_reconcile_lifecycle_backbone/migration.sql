-- Reconcile the recovered lifecycle backbone with the current platform substrate.
-- The two 20260607 migrations are immutable historical commits; this forward-only
-- migration removes their superseded projection column and tightens invariants safely.
-- @migration-safety: remediated: EaElement values are normalized before NOT NULL/CHECK; lifecycle tables are new in the immediately preceding stranded migrations and cannot receive writes before this migration applies in the same deploy.

-- CatalogLifecycleMilestone is now the canonical support-date source. The preceding
-- migration adds supportEndsAt only for historical checksum compatibility; no released
-- application writes it, so it is safe to remove before the new application starts.
ALTER TABLE "InventoryEntity" DROP COLUMN "supportEndsAt";

UPDATE "EaElement" SET "refinementLevel" = 'actual'
  WHERE ("refinementLevel" IS NULL OR "refinementLevel" NOT IN ('conceptual', 'logical', 'actual'))
    AND "infraCiKey" IS NOT NULL;

UPDATE "EaElement" SET "refinementLevel" = 'logical'
  WHERE "refinementLevel" IS NULL OR "refinementLevel" NOT IN ('conceptual', 'logical', 'actual');

ALTER TABLE "EaElement" ALTER COLUMN "refinementLevel" SET DEFAULT 'logical';
ALTER TABLE "EaElement" ALTER COLUMN "refinementLevel" SET NOT NULL;
ALTER TABLE "EaElement" ADD CONSTRAINT "EaElement_refinementLevel_check"
  CHECK ("refinementLevel" IN ('conceptual', 'logical', 'actual'));

ALTER TABLE "LifecycleEvent" ADD CONSTRAINT "LifecycleEvent_governedThingKind_check"
  CHECK ("governedThingKind" IN ('EaElement', 'DigitalProduct', 'InventoryEntity', 'ServiceOffering', 'Document', 'Agent', 'BusinessCapability'));
ALTER TABLE "LifecycleEvent" ADD CONSTRAINT "LifecycleEvent_fromStage_check"
  CHECK ("fromStage" IS NULL OR "fromStage" IN ('plan', 'design', 'build', 'production', 'retirement'));
ALTER TABLE "LifecycleEvent" ADD CONSTRAINT "LifecycleEvent_toStage_check"
  CHECK ("toStage" IS NULL OR "toStage" IN ('plan', 'design', 'build', 'production', 'retirement'));
ALTER TABLE "LifecycleEvent" ADD CONSTRAINT "LifecycleEvent_fromStatus_check"
  CHECK ("fromStatus" IS NULL OR "fromStatus" IN ('draft', 'active', 'inactive'));
ALTER TABLE "LifecycleEvent" ADD CONSTRAINT "LifecycleEvent_toStatus_check"
  CHECK ("toStatus" IS NULL OR "toStatus" IN ('draft', 'active', 'inactive'));
ALTER TABLE "LifecycleEvent" ADD CONSTRAINT "LifecycleEvent_transition_check"
  CHECK ("toStage" IS NOT NULL OR "toStatus" IS NOT NULL);

ALTER TABLE "PlateauMembership" ADD CONSTRAINT "PlateauMembership_governedThingKind_check"
  CHECK ("governedThingKind" IN ('EaElement', 'DigitalProduct', 'InventoryEntity', 'ServiceOffering', 'Document', 'Agent', 'BusinessCapability'));
ALTER TABLE "PlateauMembership" ADD CONSTRAINT "PlateauMembership_membershipSource_check"
  CHECK ("membershipSource" IN ('projected', 'curated', 'imported'));
ALTER TABLE "PlateauMembership" ADD CONSTRAINT "PlateauMembership_projectedEvidence_check"
  CHECK ("membershipSource" <> 'projected' OR "evidenceRef" IS NOT NULL);
ALTER TABLE "PlateauMembership" ADD CONSTRAINT "PlateauMembership_validity_check"
  CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");

DROP INDEX "PlateauMembership_plateauElementId_governedThingKind_govern_key";
CREATE UNIQUE INDEX "PlateauMembership_active_plateau_thing_key"
  ON "PlateauMembership"("plateauElementId", "governedThingKind", "governedThingId")
  WHERE "validTo" IS NULL;

ALTER TABLE "LifecycleGap" ADD CONSTRAINT "LifecycleGap_kind_check"
  CHECK ("kind" IN ('add', 'change', 'remove'));
ALTER TABLE "LifecycleGap" ADD CONSTRAINT "LifecycleGap_dimension_check"
  CHECK ("dimension" IN ('capability', 'technology-currency', 'vulnerability', 'data-quality', 'operational', 'cost', 'regulatory'));
ALTER TABLE "LifecycleGap" ADD CONSTRAINT "LifecycleGap_severity_check"
  CHECK ("severity" IN ('info', 'low', 'medium', 'high', 'critical'));
ALTER TABLE "LifecycleGap" ADD CONSTRAINT "LifecycleGap_status_check"
  CHECK ("status" IN ('open', 'scoped', 'resolved', 'dismissed'));
ALTER TABLE "LifecycleGap" ADD CONSTRAINT "LifecycleGap_scopeLevel_check"
  CHECK ("scopeLevel" IN ('portfolio', 'product'));
ALTER TABLE "LifecycleGap" ADD CONSTRAINT "LifecycleGap_governedThingKind_check"
  CHECK ("governedThingKind" IN ('EaElement', 'DigitalProduct', 'InventoryEntity', 'ServiceOffering', 'Document', 'Agent', 'BusinessCapability'));
ALTER TABLE "LifecycleGap" ADD CONSTRAINT "LifecycleGap_productScope_check"
  CHECK ("scopeLevel" <> 'product' OR "digitalProductId" IS NOT NULL);
