CREATE TABLE "ProviderCapacityStatus" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "retryAt" TIMESTAMP(3),
    "retryAfterSeconds" INTEGER,
    "providerCode" TEXT,
    "safeSummary" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "isHumanActionRequired" BOOLEAN NOT NULL DEFAULT false,
    "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "rawSnippet" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCapacityStatus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderCapacityStatus_providerId_key" ON "ProviderCapacityStatus"("providerId");
CREATE INDEX "ProviderCapacityStatus_state_retryAt_idx" ON "ProviderCapacityStatus"("state", "retryAt");
CREATE INDEX "ProviderCapacityStatus_isHumanActionRequired_updatedAt_idx" ON "ProviderCapacityStatus"("isHumanActionRequired", "updatedAt");

ALTER TABLE "ProviderCapacityStatus" ADD CONSTRAINT "ProviderCapacityStatus_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ModelProvider"("providerId") ON DELETE CASCADE ON UPDATE CASCADE;
