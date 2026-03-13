-- AlterTable
ALTER TABLE "ModelProvider" ADD COLUMN     "authEndpoint" TEXT,
ADD COLUMN     "authHeader" TEXT,
ADD COLUMN     "computeWatts" DOUBLE PRECISION,
ADD COLUMN     "costModel" TEXT NOT NULL DEFAULT 'token',
ADD COLUMN     "electricityRateKwh" DOUBLE PRECISION,
ADD COLUMN     "enabledFamilies" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "endpoint" TEXT,
ADD COLUMN     "inputPricePerMToken" DOUBLE PRECISION,
ADD COLUMN     "outputPricePerMToken" DOUBLE PRECISION,
ALTER COLUMN "status" SET DEFAULT 'unconfigured';

-- CreateTable
CREATE TABLE "TokenUsage" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "contextKey" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "inferenceMs" INTEGER,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schedule" TEXT NOT NULL DEFAULT 'weekly',
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledJob_jobId_key" ON "ScheduledJob"("jobId");
