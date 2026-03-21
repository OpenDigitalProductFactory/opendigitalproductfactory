-- CreateTable
CREATE TABLE "PlatformSetupProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "organizationId" TEXT,
    "currentStep" TEXT NOT NULL DEFAULT 'business-identity',
    "steps" JSONB NOT NULL DEFAULT '{}',
    "context" JSONB NOT NULL DEFAULT '{}',
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetupProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSetupProgress_userId_key" ON "PlatformSetupProgress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSetupProgress_organizationId_key" ON "PlatformSetupProgress"("organizationId");

-- AddForeignKey
ALTER TABLE "PlatformSetupProgress" ADD CONSTRAINT "PlatformSetupProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformSetupProgress" ADD CONSTRAINT "PlatformSetupProgress_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ModelProvider" ADD COLUMN "userFacingDescription" JSONB;
