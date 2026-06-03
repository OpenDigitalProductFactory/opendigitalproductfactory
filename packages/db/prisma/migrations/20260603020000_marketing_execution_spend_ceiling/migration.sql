-- EP-MARKETING-EXEC Phase 4: per-channel weekly spend ceiling.

CREATE TABLE IF NOT EXISTS "MarketingChannelSpendCeiling" (
    "ceilingId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "weeklyCapCents" INTEGER NOT NULL,
    "notes" TEXT,
    "lastSetByUserId" TEXT NOT NULL,
    "lastSetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingChannelSpendCeiling_pkey" PRIMARY KEY ("ceilingId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MarketingChannelSpendCeiling_organizationId_channelId_key"
    ON "MarketingChannelSpendCeiling"("organizationId", "channelId");

CREATE INDEX IF NOT EXISTS "MarketingChannelSpendCeiling_channelId_idx"
    ON "MarketingChannelSpendCeiling"("channelId");
