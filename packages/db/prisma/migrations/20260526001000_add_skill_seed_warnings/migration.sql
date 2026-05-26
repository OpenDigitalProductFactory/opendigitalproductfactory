CREATE TABLE "SkillSeedWarning" (
    "id" TEXT NOT NULL,
    "warningId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "warningType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "legacyPath" TEXT,
    "pluginPath" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'dpf-platform-plugin',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillSeedWarning_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SkillSeedWarning_warningId_key" ON "SkillSeedWarning"("warningId");
CREATE INDEX "SkillSeedWarning_skillId_idx" ON "SkillSeedWarning"("skillId");
CREATE INDEX "SkillSeedWarning_warningType_idx" ON "SkillSeedWarning"("warningType");
CREATE INDEX "SkillSeedWarning_resolvedAt_idx" ON "SkillSeedWarning"("resolvedAt");
