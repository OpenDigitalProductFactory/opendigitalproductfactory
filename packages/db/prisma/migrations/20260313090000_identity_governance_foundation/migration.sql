-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentOwnership" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "responsibility" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentOwnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCapabilityClass" (
    "id" TEXT NOT NULL,
    "capabilityClassId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "riskBand" TEXT NOT NULL,
    "defaultActionScope" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCapabilityClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectivePolicyClass" (
    "id" TEXT NOT NULL,
    "policyClassId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "configCategory" TEXT NOT NULL,
    "approvalMode" TEXT NOT NULL,
    "allowedRiskBand" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectivePolicyClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentGovernanceProfile" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "capabilityClassId" TEXT NOT NULL,
    "directivePolicyClassId" TEXT NOT NULL,
    "autonomyLevel" TEXT NOT NULL,
    "hitlPolicy" TEXT NOT NULL,
    "allowDelegation" BOOLEAN NOT NULL DEFAULT true,
    "maxDelegationRiskBand" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentGovernanceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DelegationGrant" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "grantorUserId" TEXT NOT NULL,
    "granteeAgentId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "scopeJson" JSONB NOT NULL,
    "reason" TEXT,
    "riskBand" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "workflowKey" TEXT,
    "objectRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DelegationGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorizationDecisionLog" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorRef" TEXT NOT NULL,
    "humanContextRef" TEXT,
    "agentContextRef" TEXT,
    "delegationGrantId" TEXT,
    "actionKey" TEXT NOT NULL,
    "objectRef" TEXT,
    "decision" TEXT NOT NULL,
    "rationale" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthorizationDecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_teamId_key" ON "Team"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembership_teamId_userId_key" ON "TeamMembership"("teamId", "userId");

-- CreateIndex
CREATE INDEX "TeamMembership_userId_idx" ON "TeamMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentOwnership_agentId_teamId_responsibility_key" ON "AgentOwnership"("agentId", "teamId", "responsibility");

-- CreateIndex
CREATE INDEX "AgentOwnership_teamId_idx" ON "AgentOwnership"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCapabilityClass_capabilityClassId_key" ON "AgentCapabilityClass"("capabilityClassId");

-- CreateIndex
CREATE UNIQUE INDEX "DirectivePolicyClass_policyClassId_key" ON "DirectivePolicyClass"("policyClassId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentGovernanceProfile_agentId_key" ON "AgentGovernanceProfile"("agentId");

-- CreateIndex
CREATE INDEX "AgentGovernanceProfile_capabilityClassId_idx" ON "AgentGovernanceProfile"("capabilityClassId");

-- CreateIndex
CREATE INDEX "AgentGovernanceProfile_directivePolicyClassId_idx" ON "AgentGovernanceProfile"("directivePolicyClassId");

-- CreateIndex
CREATE UNIQUE INDEX "DelegationGrant_grantId_key" ON "DelegationGrant"("grantId");

-- CreateIndex
CREATE INDEX "DelegationGrant_grantorUserId_idx" ON "DelegationGrant"("grantorUserId");

-- CreateIndex
CREATE INDEX "DelegationGrant_granteeAgentId_idx" ON "DelegationGrant"("granteeAgentId");

-- CreateIndex
CREATE INDEX "DelegationGrant_status_expiresAt_idx" ON "DelegationGrant"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorizationDecisionLog_decisionId_key" ON "AuthorizationDecisionLog"("decisionId");

-- CreateIndex
CREATE INDEX "AuthorizationDecisionLog_decision_idx" ON "AuthorizationDecisionLog"("decision");

-- CreateIndex
CREATE INDEX "AuthorizationDecisionLog_createdAt_idx" ON "AuthorizationDecisionLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuthorizationDecisionLog_actorRef_idx" ON "AuthorizationDecisionLog"("actorRef");

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentOwnership" ADD CONSTRAINT "AgentOwnership_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentOwnership" ADD CONSTRAINT "AgentOwnership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentGovernanceProfile" ADD CONSTRAINT "AgentGovernanceProfile_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentGovernanceProfile" ADD CONSTRAINT "AgentGovernanceProfile_capabilityClassId_fkey" FOREIGN KEY ("capabilityClassId") REFERENCES "AgentCapabilityClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentGovernanceProfile" ADD CONSTRAINT "AgentGovernanceProfile_directivePolicyClassId_fkey" FOREIGN KEY ("directivePolicyClassId") REFERENCES "DirectivePolicyClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelegationGrant" ADD CONSTRAINT "DelegationGrant_grantorUserId_fkey" FOREIGN KEY ("grantorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelegationGrant" ADD CONSTRAINT "DelegationGrant_granteeAgentId_fkey" FOREIGN KEY ("granteeAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorizationDecisionLog" ADD CONSTRAINT "AuthorizationDecisionLog_delegationGrantId_fkey" FOREIGN KEY ("delegationGrantId") REFERENCES "DelegationGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
