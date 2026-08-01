-- Preserve business-brief evidence while making its owning build relation explicit.
-- Historical invalid links are nulled before the FK is added; the live preflight
-- recorded zero orphaned rows.
UPDATE "BusinessBuildBrief" AS brief
SET "featureBuildId" = NULL
WHERE brief."featureBuildId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "FeatureBuild" AS build
    WHERE build."id" = brief."featureBuildId"
  );

ALTER TABLE "BusinessBuildBrief"
ADD CONSTRAINT "BusinessBuildBrief_featureBuildId_fkey"
FOREIGN KEY ("featureBuildId") REFERENCES "FeatureBuild"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
