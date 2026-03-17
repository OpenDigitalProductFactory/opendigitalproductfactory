-- Build Disciplines evidence fields on FeatureBuild
ALTER TABLE "FeatureBuild" ADD COLUMN "designDoc" JSONB;
ALTER TABLE "FeatureBuild" ADD COLUMN "designReview" JSONB;
ALTER TABLE "FeatureBuild" ADD COLUMN "buildPlan" JSONB;
ALTER TABLE "FeatureBuild" ADD COLUMN "planReview" JSONB;
ALTER TABLE "FeatureBuild" ADD COLUMN "taskResults" JSONB;
ALTER TABLE "FeatureBuild" ADD COLUMN "verificationOut" JSONB;
ALTER TABLE "FeatureBuild" ADD COLUMN "acceptanceMet" JSONB;
ALTER TABLE "FeatureBuild" ADD COLUMN "accountableEmployeeId" TEXT;
ALTER TABLE "FeatureBuild" ADD COLUMN "claimedByAgentId" TEXT;
ALTER TABLE "FeatureBuild" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "FeatureBuild" ADD COLUMN "claimStatus" TEXT;
ALTER TABLE "FeatureBuild" ADD CONSTRAINT "FeatureBuild_accountableEmployeeId_fkey" FOREIGN KEY ("accountableEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Accountability + claim fields on Epic
ALTER TABLE "Epic" ADD COLUMN "accountableEmployeeId" TEXT;
ALTER TABLE "Epic" ADD COLUMN "claimedById" TEXT;
ALTER TABLE "Epic" ADD COLUMN "claimedByAgentId" TEXT;
ALTER TABLE "Epic" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "Epic" ADD COLUMN "claimStatus" TEXT;
ALTER TABLE "Epic" ADD CONSTRAINT "Epic_accountableEmployeeId_fkey" FOREIGN KEY ("accountableEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Accountability + claim fields on BacklogItem
ALTER TABLE "BacklogItem" ADD COLUMN "accountableEmployeeId" TEXT;
ALTER TABLE "BacklogItem" ADD COLUMN "claimedById" TEXT;
ALTER TABLE "BacklogItem" ADD COLUMN "claimedByAgentId" TEXT;
ALTER TABLE "BacklogItem" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "BacklogItem" ADD COLUMN "claimStatus" TEXT;
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_accountableEmployeeId_fkey" FOREIGN KEY ("accountableEmployeeId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
