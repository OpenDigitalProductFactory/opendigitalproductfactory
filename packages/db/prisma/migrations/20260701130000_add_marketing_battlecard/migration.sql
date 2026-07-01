-- Marketing competitive battlecard (EP-MARKETING-EXEC parity slice C). Additive
-- only: new MarketingBattlecard table (one card per competitor) with FK to
-- Organization. Array columns hold strengths/weaknesses/differentiators/win
-- themes; objectionHandling is JSONB (array of {objection, response}).

-- CreateTable
CREATE TABLE "MarketingBattlecard" (
    "battlecardId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "competitorName" TEXT NOT NULL,
    "positioning" TEXT,
    "theirStrengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "theirWeaknesses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ourDifferentiators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "winThemes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "objectionHandling" JSONB,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdByAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingBattlecard_pkey" PRIMARY KEY ("battlecardId")
);

-- CreateIndex
CREATE INDEX "MarketingBattlecard_organizationId_createdAt_idx" ON "MarketingBattlecard"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingBattlecard_status_idx" ON "MarketingBattlecard"("status");

-- AddForeignKey
ALTER TABLE "MarketingBattlecard" ADD CONSTRAINT "MarketingBattlecard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
