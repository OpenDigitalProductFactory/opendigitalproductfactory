-- BI-D6DFC0E7 (EP-COMPETENCE-FLYWHEEL, host-agent scope): fleet-observable
-- agent-surface readiness. Each build surface heartbeats its already-computed
-- readiness state here so the daily digest can raise a surface that is not
-- wired to durable memory or has gone silent.
-- @migration-safety: data-safe: additive CREATE TABLE of a brand-new relation; no existing rows can violate any of its constraints.
CREATE TABLE "AgentSurfaceReadiness" (
    "id" TEXT NOT NULL,
    "surfaceKey" TEXT NOT NULL,
    "clientKind" TEXT NOT NULL,
    "readinessState" TEXT NOT NULL,
    "dpfPlatformVersion" TEXT,
    "mcpOk" BOOLEAN NOT NULL DEFAULT false,
    "mcpReason" TEXT,
    "detail" JSONB,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSurfaceReadiness_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentSurfaceReadiness_surfaceKey_key" ON "AgentSurfaceReadiness"("surfaceKey");

CREATE INDEX "AgentSurfaceReadiness_clientKind_idx" ON "AgentSurfaceReadiness"("clientKind");

CREATE INDEX "AgentSurfaceReadiness_reportedAt_idx" ON "AgentSurfaceReadiness"("reportedAt" DESC);
