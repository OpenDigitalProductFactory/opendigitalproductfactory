-- Phase 2: Enrich SkillDefinition with SKILL.md pattern fields
ALTER TABLE "SkillDefinition" ADD COLUMN "triggerPattern" TEXT;
ALTER TABLE "SkillDefinition" ADD COLUMN "userInvocable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SkillDefinition" ADD COLUMN "agentInvocable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SkillDefinition" ADD COLUMN "allowedTools" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SkillDefinition" ADD COLUMN "composesFrom" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SkillDefinition" ADD COLUMN "contextRequirements" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SkillDefinition" ADD COLUMN "capability" TEXT;
ALTER TABLE "SkillDefinition" ADD COLUMN "taskType" TEXT NOT NULL DEFAULT 'conversation';

-- Phase 6: DelegationChain model for authority propagation and chain of custody
CREATE TABLE "DelegationChain" (
    "id" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "fromAgentId" TEXT NOT NULL,
    "toAgentId" TEXT NOT NULL,
    "skillId" TEXT,
    "authorityScope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "originUserId" TEXT NOT NULL,
    "originAuthority" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "reason" TEXT,
    "parentLinkId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DelegationChain_pkey" PRIMARY KEY ("id")
);

-- Indexes for DelegationChain
CREATE INDEX "DelegationChain_chainId_idx" ON "DelegationChain"("chainId");
CREATE INDEX "DelegationChain_fromAgentId_idx" ON "DelegationChain"("fromAgentId");
CREATE INDEX "DelegationChain_toAgentId_idx" ON "DelegationChain"("toAgentId");
CREATE INDEX "DelegationChain_status_idx" ON "DelegationChain"("status");
