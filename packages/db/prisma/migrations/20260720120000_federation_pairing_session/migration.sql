-- Expiring device-style pairing transport. FederationBootstrapToken remains
-- invitation authority; FederationLink remains relationship/trust authority.
CREATE TABLE "FederationPairingSession" (
    "id" TEXT NOT NULL,
    "pairingId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "relationshipPreset" TEXT NOT NULL DEFAULT 'same-organization',
    "projectionTemplateKey" TEXT NOT NULL DEFAULT 'same-organization',
    "matchingCode" TEXT NOT NULL,
    "pairingSecretHash" TEXT,
    "pairingSecretEnc" TEXT,
    "peerAuthorityUrl" TEXT NOT NULL,
    "peerDisplayName" TEXT NOT NULL,
    "peerInstallationId" TEXT,
    "candidateDiscoveryId" TEXT,
    "bootstrapTokenId" TEXT,
    "bootstrapTokenEnc" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedByPrincipalId" TEXT,
    "deniedAt" TIMESTAMP(3),
    "deniedByPrincipalId" TEXT,
    "denialReason" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastPolledAt" TIMESTAMP(3),
    "pollCount" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FederationPairingSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FederationPairingSession_pairingId_key"
ON "FederationPairingSession"("pairingId");

CREATE UNIQUE INDEX "FederationPairingSession_pairingSecretHash_key"
ON "FederationPairingSession"("pairingSecretHash");

CREATE UNIQUE INDEX "FederationPairingSession_bootstrapTokenId_key"
ON "FederationPairingSession"("bootstrapTokenId");

CREATE INDEX "FederationPairingSession_status_expiresAt_idx"
ON "FederationPairingSession"("status", "expiresAt");

CREATE INDEX "FederationPairingSession_direction_status_idx"
ON "FederationPairingSession"("direction", "status");

CREATE INDEX "FederationPairingSession_peerInstallationId_idx"
ON "FederationPairingSession"("peerInstallationId");

ALTER TABLE "FederationPairingSession"
ADD CONSTRAINT "FederationPairingSession_bootstrapTokenId_fkey"
FOREIGN KEY ("bootstrapTokenId") REFERENCES "FederationBootstrapToken"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
