-- AlterTable
ALTER TABLE "ImprovementProposal" ADD COLUMN "targetSkillId" TEXT;

-- CreateIndex
CREATE INDEX "ImprovementProposal_targetSkillId_idx" ON "ImprovementProposal"("targetSkillId");

-- CreateTable
CREATE TABLE "SkillRevision" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "changeReason" TEXT,
    "changedBy" TEXT,
    "proposalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SkillRevision_revisionId_key" ON "SkillRevision"("revisionId");

-- CreateIndex
CREATE INDEX "SkillRevision_skillId_createdAt_idx" ON "SkillRevision"("skillId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SkillRevision_proposalId_idx" ON "SkillRevision"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillRevision_skillId_version_key" ON "SkillRevision"("skillId", "version");

-- AddForeignKey
ALTER TABLE "SkillRevision" ADD CONSTRAINT "SkillRevision_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "SkillDefinition"("skillId") ON DELETE CASCADE ON UPDATE CASCADE;
