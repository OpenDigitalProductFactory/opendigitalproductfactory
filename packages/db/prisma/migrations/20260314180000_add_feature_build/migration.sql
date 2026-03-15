-- AlterTable
ALTER TABLE "ModelProfile" ADD COLUMN     "codingCapability" TEXT;

-- CreateTable
CREATE TABLE "FeatureBuild" (
    "id" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "portfolioId" TEXT,
    "brief" JSONB,
    "plan" JSONB,
    "phase" TEXT NOT NULL DEFAULT 'ideate',
    "sandboxId" TEXT,
    "sandboxPort" INTEGER,
    "diffSummary" TEXT,
    "diffPatch" TEXT,
    "codingProvider" TEXT,
    "threadId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureBuild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturePack" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "portfolioContext" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "manifest" JSONB NOT NULL,
    "screenshot" TEXT,
    "buildId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'local',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeaturePack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeatureBuild_buildId_key" ON "FeatureBuild"("buildId");

-- CreateIndex
CREATE INDEX "FeatureBuild_phase_idx" ON "FeatureBuild"("phase");

-- CreateIndex
CREATE INDEX "FeatureBuild_createdById_idx" ON "FeatureBuild"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturePack_packId_key" ON "FeaturePack"("packId");

-- AddForeignKey
ALTER TABLE "FeatureBuild" ADD CONSTRAINT "FeatureBuild_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
