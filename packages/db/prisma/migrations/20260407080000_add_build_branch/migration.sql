-- Add buildBranch field to FeatureBuild for git branch tracking
ALTER TABLE "FeatureBuild" ADD COLUMN IF NOT EXISTS "buildBranch" TEXT;
