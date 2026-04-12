-- AlterTable: Add contribution review fields to FeaturePack
ALTER TABLE "FeaturePack" ADD COLUMN "mergeReadiness" TEXT;
ALTER TABLE "FeaturePack" ADD COLUMN "applicableVerticals" TEXT[] DEFAULT '{}';
ALTER TABLE "FeaturePack" ADD COLUMN "sourceVertical" TEXT;
ALTER TABLE "FeaturePack" ADD COLUMN "reusabilityScope" TEXT;
ALTER TABLE "FeaturePack" ADD COLUMN "prUrl" TEXT;
ALTER TABLE "FeaturePack" ADD COLUMN "prNumber" INTEGER;
ALTER TABLE "FeaturePack" ADD COLUMN "reviewReport" JSONB;
ALTER TABLE "FeaturePack" ADD COLUMN "reviewedAt" TIMESTAMP(3);
