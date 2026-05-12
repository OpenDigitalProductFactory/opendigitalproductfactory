-- DPF Edge Node registry — implements
-- docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
-- (binding as of 2026-05-12, PR #491).
--
-- Identity for an Edge Node lives on Principal + PrincipalAlias
-- (kind="edge-node", aliasType="edge-node") per AGENTS.md §11
-- Principal convergence. The EdgeNode table holds host-specific
-- attributes only and is keyed 1:1 to Principal via principalId.

-- AlterTable
ALTER TABLE "DiscoveryRun" ADD COLUMN     "edgeNodeId" TEXT;

-- CreateTable
CREATE TABLE "EdgeNode" (
    "id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "installMode" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "trustState" TEXT NOT NULL DEFAULT 'pending',
    "lastSeenAt" TIMESTAMP(3),
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB,
    "enrollmentTokenId" TEXT,
    "enrolledAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByPrincipalId" TEXT,
    "tokenRotatedAt" TIMESTAMP(3),
    "quarantinedAt" TIMESTAMP(3),
    "quarantineReason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EdgeNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "revocationReason" TEXT,
    "metadata" JSONB,

    CONSTRAINT "BootstrapToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EdgeNodeCapability" (
    "id" TEXT NOT NULL,
    "edgeNodeId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'reporting-only',
    "status" TEXT NOT NULL DEFAULT 'healthy',
    "evidence" JSONB,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EdgeNodeCapability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EdgeNode_principalId_key" ON "EdgeNode"("principalId");

-- CreateIndex
CREATE UNIQUE INDEX "EdgeNode_nodeId_key" ON "EdgeNode"("nodeId");

-- CreateIndex
CREATE INDEX "EdgeNode_status_idx" ON "EdgeNode"("status");

-- CreateIndex
CREATE INDEX "EdgeNode_trustState_idx" ON "EdgeNode"("trustState");

-- CreateIndex
CREATE INDEX "EdgeNode_lastSeenAt_idx" ON "EdgeNode"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "BootstrapToken_tokenHash_key" ON "BootstrapToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "BootstrapToken_consumedByEdgeNodeId_key" ON "BootstrapToken"("consumedByEdgeNodeId");

-- CreateIndex
CREATE INDEX "BootstrapToken_expiresAt_idx" ON "BootstrapToken"("expiresAt");

-- CreateIndex
CREATE INDEX "BootstrapToken_consumedAt_idx" ON "BootstrapToken"("consumedAt");

-- CreateIndex
CREATE INDEX "EdgeNodeCapability_capability_idx" ON "EdgeNodeCapability"("capability");

-- CreateIndex
CREATE UNIQUE INDEX "EdgeNodeCapability_edgeNodeId_capability_key" ON "EdgeNodeCapability"("edgeNodeId", "capability");

-- CreateIndex
CREATE INDEX "DiscoveryRun_edgeNodeId_idx" ON "DiscoveryRun"("edgeNodeId");

-- AddForeignKey
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_edgeNodeId_fkey" FOREIGN KEY ("edgeNodeId") REFERENCES "EdgeNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EdgeNode" ADD CONSTRAINT "EdgeNode_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "Principal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BootstrapToken" ADD CONSTRAINT "BootstrapToken_consumedByEdgeNodeId_fkey" FOREIGN KEY ("consumedByEdgeNodeId") REFERENCES "EdgeNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EdgeNodeCapability" ADD CONSTRAINT "EdgeNodeCapability_edgeNodeId_fkey" FOREIGN KEY ("edgeNodeId") REFERENCES "EdgeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
