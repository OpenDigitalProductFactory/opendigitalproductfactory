-- EP-VST-001: Value Stream Team Architecture tables
-- EP-CTX-001: PhaseHandoff.compressedSummary column

-- PhaseHandoff: add compressedSummary for context budget utility-tier summaries
ALTER TABLE "PhaseHandoff" ADD COLUMN "compressedSummary" TEXT;

-- ValueStreamTeam
CREATE TABLE "ValueStreamTeam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "valueStream" TEXT NOT NULL,
    "teamPattern" TEXT NOT NULL,
    "coordinationPattern" JSONB NOT NULL,
    "eaProcessId" TEXT,
    "eaViewId" TEXT,
    "portfolioId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValueStreamTeam_pkey" PRIMARY KEY ("id")
);

-- ValueStreamTeamRole
CREATE TABLE "ValueStreamTeamRole" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "workerType" TEXT NOT NULL,
    "agentId" TEXT,
    "humanRoleId" TEXT,
    "perspective" TEXT,
    "heuristics" TEXT,
    "interpretiveModel" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "grantScope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "modelTier" TEXT,
    "bpmnLaneId" TEXT,
    "maxRetries" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValueStreamTeamRole_pkey" PRIMARY KEY ("id")
);

-- ValueStreamHitlGate
CREATE TABLE "ValueStreamHitlGate" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "triggerPoint" TEXT NOT NULL,
    "condition" JSONB,
    "requiredRole" TEXT NOT NULL,
    "escalationTimeoutMinutes" INTEGER NOT NULL DEFAULT 30,
    "escalationPath" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "emergencyBypass" BOOLEAN NOT NULL DEFAULT false,
    "bpmnGatewayId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValueStreamHitlGate_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "ValueStreamTeam" ADD CONSTRAINT "ValueStreamTeam_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ValueStreamTeamRole" ADD CONSTRAINT "ValueStreamTeamRole_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "ValueStreamTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ValueStreamTeamRole" ADD CONSTRAINT "ValueStreamTeamRole_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ValueStreamHitlGate" ADD CONSTRAINT "ValueStreamHitlGate_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "ValueStreamTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "ValueStreamTeam_portfolioId_idx" ON "ValueStreamTeam"("portfolioId");
CREATE INDEX "ValueStreamTeam_valueStream_idx" ON "ValueStreamTeam"("valueStream");
CREATE INDEX "ValueStreamTeamRole_teamId_idx" ON "ValueStreamTeamRole"("teamId");
CREATE INDEX "ValueStreamTeamRole_agentId_idx" ON "ValueStreamTeamRole"("agentId");
CREATE INDEX "ValueStreamHitlGate_teamId_idx" ON "ValueStreamHitlGate"("teamId");
