-- CreateTable
CREATE TABLE "PlatformDevConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "contributionMode" TEXT NOT NULL DEFAULT 'selective',
    "gitRemoteUrl" TEXT,
    "updatePending" BOOLEAN NOT NULL DEFAULT false,
    "pendingVersion" TEXT,
    "configuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "configuredById" TEXT,

    CONSTRAINT "PlatformDevConfig_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PlatformDevConfig" ADD CONSTRAINT "PlatformDevConfig_configuredById_fkey" FOREIGN KEY ("configuredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
