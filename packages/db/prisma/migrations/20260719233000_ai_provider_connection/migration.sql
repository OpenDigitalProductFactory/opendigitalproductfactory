-- Separate provider catalog/runtime identity from a configured account/channel.
-- Account class, contracts, and entitlements default to unknown/unreviewed so
-- existing credentials never acquire enterprise rights during backfill.
CREATE TABLE "AiProviderConnection" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "organizationId" TEXT,
    "providerId" TEXT NOT NULL,
    "credentialEntryId" TEXT,
    "financeProfileId" TEXT,
    "supplierContractId" TEXT,
    "capacityStatusId" TEXT,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unconfigured',
    "executionChannel" TEXT NOT NULL,
    "accountClass" TEXT NOT NULL DEFAULT 'unknown',
    "commercialBasis" TEXT NOT NULL DEFAULT 'unknown',
    "authMethod" TEXT NOT NULL DEFAULT 'unknown',
    "contractEvidence" JSONB NOT NULL DEFAULT '{}',
    "entitlements" JSONB NOT NULL DEFAULT '{}',
    "evidenceStatus" TEXT NOT NULL DEFAULT 'unreviewed',
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiProviderConnection_connectionId_key" ON "AiProviderConnection"("connectionId");
CREATE UNIQUE INDEX "AiProviderConnection_credentialEntryId_key" ON "AiProviderConnection"("credentialEntryId");
CREATE UNIQUE INDEX "AiProviderConnection_capacityStatusId_key" ON "AiProviderConnection"("capacityStatusId");
CREATE INDEX "AiProviderConnection_organizationId_status_idx" ON "AiProviderConnection"("organizationId", "status");
CREATE INDEX "AiProviderConnection_providerId_status_idx" ON "AiProviderConnection"("providerId", "status");
CREATE INDEX "AiProviderConnection_financeProfileId_idx" ON "AiProviderConnection"("financeProfileId");
CREATE INDEX "AiProviderConnection_supplierContractId_idx" ON "AiProviderConnection"("supplierContractId");

ALTER TABLE "AiProviderConnection" ADD CONSTRAINT "AiProviderConnection_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiProviderConnection" ADD CONSTRAINT "AiProviderConnection_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "ModelProvider"("providerId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiProviderConnection" ADD CONSTRAINT "AiProviderConnection_credentialEntryId_fkey"
  FOREIGN KEY ("credentialEntryId") REFERENCES "CredentialEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiProviderConnection" ADD CONSTRAINT "AiProviderConnection_financeProfileId_fkey"
  FOREIGN KEY ("financeProfileId") REFERENCES "AiProviderFinanceProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiProviderConnection" ADD CONSTRAINT "AiProviderConnection_supplierContractId_fkey"
  FOREIGN KEY ("supplierContractId") REFERENCES "SupplierContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiProviderConnection" ADD CONSTRAINT "AiProviderConnection_capacityStatusId_fkey"
  FOREIGN KEY ("capacityStatusId") REFERENCES "ProviderCapacityStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "AiProviderConnection" (
  "id",
  "connectionId",
  "providerId",
  "credentialEntryId",
  "financeProfileId",
  "capacityStatusId",
  "label",
  "status",
  "executionChannel",
  "commercialBasis",
  "authMethod",
  "updatedAt"
)
SELECT
  'aipc_' || md5(mp."providerId"),
  'provider-default-' || mp."providerId",
  mp."providerId",
  ce."id",
  fp."id",
  pcs."id",
  mp."name",
  mp."status",
  CASE
    WHEN mp."providerId" IN ('local', 'ollama') THEN 'local-runtime'
    WHEN mp."category" = 'router' THEN 'hosted-router'
    WHEN mp."authMethod" = 'oauth2_authorization_code' THEN 'subscription-cli'
    WHEN mp."providerId" IN ('azure-openai', 'bedrock') THEN 'cloud-tenant'
    ELSE 'direct-api'
  END,
  CASE
    WHEN mp."providerId" IN ('local', 'ollama') THEN 'local-compute'
    WHEN mp."authMethod" = 'oauth2_authorization_code' THEN 'subscription-included'
    ELSE 'unknown'
  END,
  CASE
    WHEN mp."authMethod" = 'api_key' THEN 'api-key'
    WHEN mp."authMethod" = 'oauth2_authorization_code' THEN 'oauth'
    WHEN mp."authMethod" = 'oauth2_client_credentials' THEN 'workload-identity'
    WHEN mp."authMethod" = 'none' THEN 'local'
    ELSE 'unknown'
  END,
  CURRENT_TIMESTAMP
FROM "ModelProvider" mp
LEFT JOIN "CredentialEntry" ce ON ce."providerId" = mp."providerId"
LEFT JOIN "AiProviderFinanceProfile" fp ON fp."providerId" = mp."providerId"
LEFT JOIN "ProviderCapacityStatus" pcs ON pcs."providerId" = mp."providerId"
WHERE mp."endpointType" <> 'transcription';
