-- DPF Edge Node Phase 0 (A1) — schema only.
-- Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
-- Roadmap: docs/superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md
--
-- Three new tables:
--   EdgeNode               Host-resident agent. Operational state +
--                          machine-bound dpfedge_* token (hashed).
--   BootstrapToken         One-time enrollment token issued by an
--                          operator (or installer for local-host).
--   EdgeNodeCapability     Per-(node, capability) decision row.
--                          Authority's accepted set lives here.
--
-- Plus an additive optional FK on DiscoveryRun for edgeNodeId
-- attribution. Nullable because (a) historical runs predate this
-- model and (b) bootstrap-discovery runs run inside the portal
-- container and have no edgeNodeId.

-- ── EdgeNode ────────────────────────────────────────────────────────────────

CREATE TABLE "EdgeNode" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "installMode" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "trustState" TEXT NOT NULL DEFAULT 'pending',
    "lastSeenAt" TIMESTAMP(3),
    "capabilities" JSONB NOT NULL,
    "metadata" JSONB,
    "tokenHash" TEXT,
    "tokenPrefix" TEXT,
    "tokenRotatedAt" TIMESTAMP(3),
    "enrolledAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByPrincipalId" TEXT,
    "quarantinedAt" TIMESTAMP(3),
    "quarantineReason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EdgeNode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EdgeNode_nodeId_key" ON "EdgeNode"("nodeId");
CREATE UNIQUE INDEX "EdgeNode_tokenHash_key" ON "EdgeNode"("tokenHash");
CREATE INDEX "EdgeNode_trustState_idx" ON "EdgeNode"("trustState");
CREATE INDEX "EdgeNode_status_idx" ON "EdgeNode"("status");
CREATE INDEX "EdgeNode_tokenHash_idx" ON "EdgeNode"("tokenHash");
CREATE INDEX "EdgeNode_lastSeenAt_idx" ON "EdgeNode"("lastSeenAt");

ALTER TABLE "EdgeNode" ADD CONSTRAINT "EdgeNode_approvedByPrincipalId_fkey"
    FOREIGN KEY ("approvedByPrincipalId") REFERENCES "Principal"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── BootstrapToken ──────────────────────────────────────────────────────────

CREATE TABLE "BootstrapToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'edge:enroll',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedByPrincipalId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedByEdgeNodeId" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "BootstrapToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BootstrapToken_tokenHash_key" ON "BootstrapToken"("tokenHash");
CREATE INDEX "BootstrapToken_tokenHash_idx" ON "BootstrapToken"("tokenHash");
CREATE INDEX "BootstrapToken_expiresAt_idx" ON "BootstrapToken"("expiresAt");
CREATE INDEX "BootstrapToken_consumedAt_idx" ON "BootstrapToken"("consumedAt");

ALTER TABLE "BootstrapToken" ADD CONSTRAINT "BootstrapToken_issuedByPrincipalId_fkey"
    FOREIGN KEY ("issuedByPrincipalId") REFERENCES "Principal"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BootstrapToken" ADD CONSTRAINT "BootstrapToken_consumedByEdgeNodeId_fkey"
    FOREIGN KEY ("consumedByEdgeNodeId") REFERENCES "EdgeNode"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── EdgeNodeCapability ──────────────────────────────────────────────────────

CREATE TABLE "EdgeNodeCapability" (
    "id" TEXT NOT NULL,
    "edgeNodeId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'disabled',
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "evidence" JSONB,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EdgeNodeCapability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EdgeNodeCapability_edgeNodeId_capability_key"
    ON "EdgeNodeCapability"("edgeNodeId", "capability");
CREATE INDEX "EdgeNodeCapability_capability_idx"
    ON "EdgeNodeCapability"("capability");

ALTER TABLE "EdgeNodeCapability" ADD CONSTRAINT "EdgeNodeCapability_edgeNodeId_fkey"
    FOREIGN KEY ("edgeNodeId") REFERENCES "EdgeNode"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── DiscoveryRun.edgeNodeId (additive, nullable) ────────────────────────────

ALTER TABLE "DiscoveryRun" ADD COLUMN "edgeNodeId" TEXT;

CREATE INDEX "DiscoveryRun_edgeNodeId_idx" ON "DiscoveryRun"("edgeNodeId");

ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_edgeNodeId_fkey"
    FOREIGN KEY ("edgeNodeId") REFERENCES "EdgeNode"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
