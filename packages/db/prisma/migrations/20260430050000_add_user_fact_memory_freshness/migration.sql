-- AlterTable
ALTER TABLE "UserFact"
ADD COLUMN "sourceAgentId" TEXT,
ADD COLUMN "sourceOperatingProfileFingerprint" TEXT,
ADD COLUMN "lastValidatedAt" TIMESTAMP(3),
ADD COLUMN "validatedAgainstFingerprint" TEXT;

-- CreateIndex
CREATE INDEX "UserFact_sourceAgentId_supersededAt_idx" ON "UserFact"("sourceAgentId", "supersededAt");
