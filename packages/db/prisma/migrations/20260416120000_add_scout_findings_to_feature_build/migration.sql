-- Add scoutFindings field to FeatureBuild
ALTER TABLE "FeatureBuild" ADD COLUMN "scoutFindings" JSONB;
