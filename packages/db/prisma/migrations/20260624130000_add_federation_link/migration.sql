-- EP-MSP-FEDERATION · B1 (BI-130107D6) — sovereign-peer federation link. The
-- edge-node enrollment handshake generalized to deployment-to-deployment:
-- dual-approved, outbound-only, revocable. Identity converges on Principal
-- (kind="federated-peer") with FederationLink as the side table.
CREATE TABLE "FederationLink" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "peerAuthorityUrl" TEXT NOT NULL,
    "peerOrganizationRef" TEXT,
    "localOrganizationId" TEXT,
    "linkState" TEXT NOT NULL DEFAULT 'pending',
    "approvedAtLocal" TIMESTAMP(3),
    "approvedAtPeer" TIMESTAMP(3),
    "approvedByPrincipalId" TEXT,
    "quarantinedAt" TIMESTAMP(3),
    "quarantineReason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "tokenHash" TEXT,
    "tokenPrefix" TEXT,
    "tokenRotatedAt" TIMESTAMP(3),
    "projectionContractId" TEXT,
    "authorityBindingId" TEXT,
    "metadata" JSONB,
    "enrolledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FederationLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FederationLink_linkId_key" ON "FederationLink"("linkId");
CREATE UNIQUE INDEX "FederationLink_principalId_key" ON "FederationLink"("principalId");
CREATE UNIQUE INDEX "FederationLink_tokenHash_key" ON "FederationLink"("tokenHash");
CREATE INDEX "FederationLink_linkState_idx" ON "FederationLink"("linkState");
CREATE INDEX "FederationLink_role_idx" ON "FederationLink"("role");
CREATE INDEX "FederationLink_tokenHash_idx" ON "FederationLink"("tokenHash");
CREATE INDEX "FederationLink_peerOrganizationRef_idx" ON "FederationLink"("peerOrganizationRef");

CREATE TABLE "FederationBootstrapToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "offeredRole" TEXT NOT NULL,
    "proposedProjection" JSONB,
    "proposedAuthorityBand" JSONB,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedByPrincipalId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedByLinkId" TEXT,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "FederationBootstrapToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FederationBootstrapToken_tokenHash_key" ON "FederationBootstrapToken"("tokenHash");
CREATE INDEX "FederationBootstrapToken_consumedByLinkId_idx" ON "FederationBootstrapToken"("consumedByLinkId");
CREATE INDEX "FederationBootstrapToken_expiresAt_idx" ON "FederationBootstrapToken"("expiresAt");

ALTER TABLE "FederationLink" ADD CONSTRAINT "FederationLink_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "Principal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FederationBootstrapToken" ADD CONSTRAINT "FederationBootstrapToken_consumedByLinkId_fkey" FOREIGN KEY ("consumedByLinkId") REFERENCES "FederationLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
