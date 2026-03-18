-- Add gitCommitHashes column to FeatureBuild
ALTER TABLE "FeatureBuild" ADD COLUMN "gitCommitHashes" TEXT[] DEFAULT ARRAY[]::TEXT[];
