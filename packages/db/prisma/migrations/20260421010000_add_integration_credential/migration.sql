-- Polymorphic credentials table for enterprise integrations (ADP, QuickBooks, Plaid, Workday, ...).
-- Distinct from CredentialEntry, which remains OAuth-shaped for LLM providers.
-- fieldsEnc + tokenCacheEnc hold JSON blobs encrypted via credential-crypto.ts encryptJson.
-- fieldsEnc example payload for ADP: { clientId, clientSecret, certPem, privateKeyPem, environment }.

-- CreateTable
CREATE TABLE "IntegrationCredential" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unconfigured',
    "fieldsEnc" TEXT NOT NULL,
    "tokenCacheEnc" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMsg" TEXT,
    "certExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredential_integrationId_key" ON "IntegrationCredential"("integrationId");

-- CreateIndex
CREATE INDEX "IntegrationCredential_provider_status_idx" ON "IntegrationCredential"("provider", "status");
