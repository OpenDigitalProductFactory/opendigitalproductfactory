-- @migration-safety: data-safe: additive nullable dispatch columns and a new certificate table cannot invalidate existing rows.
ALTER TABLE "RemoteAction"
  ADD COLUMN "dispatchNonce" TEXT,
  ADD COLUMN "dispatchIssuedAt" TIMESTAMP(3),
  ADD COLUMN "dispatchExpiresAt" TIMESTAMP(3),
  ADD COLUMN "dispatchSigningKeyId" TEXT,
  ADD COLUMN "dispatchSignature" TEXT;

CREATE TABLE "EdgeNodeCertificate" (
  "id" TEXT NOT NULL,
  "certificateId" TEXT NOT NULL,
  "edgeNodeId" TEXT NOT NULL,
  "fingerprintSha256" TEXT NOT NULL,
  "serialNumber" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "provisioner" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EdgeNodeCertificate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RemoteAction_dispatchNonce_key" ON "RemoteAction"("dispatchNonce");
CREATE UNIQUE INDEX "EdgeNodeCertificate_certificateId_key" ON "EdgeNodeCertificate"("certificateId");
CREATE UNIQUE INDEX "EdgeNodeCertificate_fingerprintSha256_key" ON "EdgeNodeCertificate"("fingerprintSha256");
CREATE UNIQUE INDEX "EdgeNodeCertificate_edgeNodeId_serialNumber_key" ON "EdgeNodeCertificate"("edgeNodeId", "serialNumber");
CREATE INDEX "EdgeNodeCertificate_edgeNodeId_status_idx" ON "EdgeNodeCertificate"("edgeNodeId", "status");
CREATE INDEX "EdgeNodeCertificate_validUntil_idx" ON "EdgeNodeCertificate"("validUntil");

ALTER TABLE "EdgeNodeCertificate"
  ADD CONSTRAINT "EdgeNodeCertificate_edgeNodeId_fkey"
  FOREIGN KEY ("edgeNodeId") REFERENCES "EdgeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
