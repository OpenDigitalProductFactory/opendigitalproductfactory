-- CreateTable: SandboxSlot — pool of sandbox instances for concurrent builds
CREATE TABLE "SandboxSlot" (
    "id" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "containerId" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "buildId" TEXT,
    "userId" TEXT,
    "acquiredAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SandboxSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ReleaseBundle — groups completed builds for coordinated deployment (IT4IT §5.3.5)
CREATE TABLE "ReleaseBundle" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'assembling',
    "createdBy" TEXT NOT NULL,
    "combinedDiffPatch" TEXT,
    "gateCheckResult" JSONB,
    "promotionId" TEXT,
    "rfcId" TEXT,
    "calendarEventId" TEXT,
    "deploymentWindowId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "deployedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseBundle_pkey" PRIMARY KEY ("id")
);

-- AlterTable: FeatureBuild — add release bundle and calendar links
ALTER TABLE "FeatureBuild" ADD COLUMN "releaseBundleId" TEXT;
ALTER TABLE "FeatureBuild" ADD COLUMN "calendarEventId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SandboxSlot_slotIndex_key" ON "SandboxSlot"("slotIndex");
CREATE UNIQUE INDEX "SandboxSlot_buildId_key" ON "SandboxSlot"("buildId");
CREATE INDEX "SandboxSlot_status_idx" ON "SandboxSlot"("status");
CREATE UNIQUE INDEX "ReleaseBundle_bundleId_key" ON "ReleaseBundle"("bundleId");
CREATE UNIQUE INDEX "ReleaseBundle_promotionId_key" ON "ReleaseBundle"("promotionId");
CREATE INDEX "ReleaseBundle_status_idx" ON "ReleaseBundle"("status");
CREATE INDEX "FeatureBuild_releaseBundleId_idx" ON "FeatureBuild"("releaseBundleId");

-- AddForeignKey
ALTER TABLE "FeatureBuild" ADD CONSTRAINT "FeatureBuild_releaseBundleId_fkey" FOREIGN KEY ("releaseBundleId") REFERENCES "ReleaseBundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
