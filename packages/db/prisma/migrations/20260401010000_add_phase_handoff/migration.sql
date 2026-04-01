-- CreateTable
CREATE TABLE "PhaseHandoff" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "buildId" TEXT NOT NULL,
    "fromPhase" TEXT NOT NULL,
    "toPhase" TEXT NOT NULL,
    "fromAgentId" TEXT NOT NULL,
    "toAgentId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "decisionsMade" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "openIssues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userPreferences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenceFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenceDigest" JSONB NOT NULL DEFAULT '{}',
    "gateResult" JSONB NOT NULL DEFAULT '{}',
    "tokenBudgetUsed" INTEGER NOT NULL DEFAULT 0,
    "toolsUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "iterationCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhaseHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhaseHandoff_buildId_idx" ON "PhaseHandoff"("buildId");

-- AddForeignKey
ALTER TABLE "PhaseHandoff" ADD CONSTRAINT "PhaseHandoff_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "FeatureBuild"("buildId") ON DELETE RESTRICT ON UPDATE CASCADE;
