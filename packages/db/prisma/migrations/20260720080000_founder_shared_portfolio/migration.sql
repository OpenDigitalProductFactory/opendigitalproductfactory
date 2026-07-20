-- Founder Hub shared-portfolio curation. The federated mirror remains the
-- inbox authority and accepted work maps to the existing BacklogItem table.
CREATE TABLE "FounderDemandCluster" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "confidence" DOUBLE PRECISION,
    "founderDisposition" TEXT,
    "canonicalBacklogItemId" TEXT,
    "releaseApplicability" JSONB,
    "dispositionAt" TIMESTAMP(3),
    "dispositionByPrincipalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FounderDemandCluster_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FounderDemandClusterMember" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "founderDemandClusterId" TEXT NOT NULL,
    "originInstallationId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "environmentClass" TEXT NOT NULL DEFAULT 'development',
    "promotedAt" TIMESTAMP(3),
    "promotedByPrincipalId" TEXT,
    "mirrorRefs" TEXT[],
    "routeAttestations" JSONB NOT NULL,
    "signalSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FounderDemandClusterMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FounderDemandCluster_clusterId_key" ON "FounderDemandCluster"("clusterId");
CREATE INDEX "FounderDemandCluster_organizationId_status_idx" ON "FounderDemandCluster"("organizationId", "status");
CREATE INDEX "FounderDemandCluster_canonicalBacklogItemId_idx" ON "FounderDemandCluster"("canonicalBacklogItemId");
CREATE UNIQUE INDEX "FounderDemandClusterMember_memberId_key" ON "FounderDemandClusterMember"("memberId");
CREATE UNIQUE INDEX "FounderDemandClusterMember_originInstallationId_envelopeId_key" ON "FounderDemandClusterMember"("originInstallationId", "envelopeId");
CREATE INDEX "FounderDemandClusterMember_founderDemandClusterId_idx" ON "FounderDemandClusterMember"("founderDemandClusterId");
CREATE INDEX "FounderDemandClusterMember_environmentClass_promotedAt_idx" ON "FounderDemandClusterMember"("environmentClass", "promotedAt");

ALTER TABLE "FounderDemandCluster" ADD CONSTRAINT "FounderDemandCluster_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FounderDemandCluster" ADD CONSTRAINT "FounderDemandCluster_canonicalBacklogItemId_fkey" FOREIGN KEY ("canonicalBacklogItemId") REFERENCES "BacklogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FounderDemandClusterMember" ADD CONSTRAINT "FounderDemandClusterMember_founderDemandClusterId_fkey" FOREIGN KEY ("founderDemandClusterId") REFERENCES "FounderDemandCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Result intake is durable independently of optional forge delivery.
ALTER TABLE "HiveContributionLedger"
    ADD COLUMN "resultBundle" JSONB,
    ADD COLUMN "sourceReceipt" TEXT,
    ADD COLUMN "deliveryProvider" TEXT,
    ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'not-requested',
    ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "deliveryRemoteRef" TEXT,
    ADD COLUMN "deliveryError" TEXT,
    ADD COLUMN "nextDeliveryAt" TIMESTAMP(3),
    ADD COLUMN "deliveredAt" TIMESTAMP(3),
    ADD COLUMN "reviewedByPrincipalId" TEXT;

-- @migration-safety: data-safe: sourceReceipt is introduced nullable above, so every pre-existing row is NULL and PostgreSQL permits multiple NULL values in a unique index.
CREATE UNIQUE INDEX "HiveContributionLedger_sourceReceipt_key" ON "HiveContributionLedger"("sourceReceipt");
CREATE INDEX "HiveContributionLedger_deliveryStatus_nextDeliveryAt_idx" ON "HiveContributionLedger"("deliveryStatus", "nextDeliveryAt");
