-- AlterTable: Add uxTestResults to FeatureBuild
ALTER TABLE "FeatureBuild" ADD COLUMN "uxTestResults" JSONB;

-- CreateTable: BuildActivity
CREATE TABLE "BuildActivity" (
    "id" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuildActivity_buildId_createdAt_idx" ON "BuildActivity"("buildId", "createdAt");

-- AddForeignKey
ALTER TABLE "BuildActivity" ADD CONSTRAINT "BuildActivity_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "FeatureBuild"("buildId") ON DELETE RESTRICT ON UPDATE CASCADE;
