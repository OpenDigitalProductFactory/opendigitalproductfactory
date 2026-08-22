-- @migration-safety: data-safe. Additive expand-only migration for BI-93507D83.
-- Creates three enum types and one empty provider-neutral projection-binding table.
-- No existing row or column is read, changed, or removed. The optional credential
-- FK is added to the new empty table and uses SET NULL so retained binding/audit
-- evidence survives credential retirement.

CREATE TYPE "ExternalChannelProjectionState" AS ENUM ('reserved', 'current', 'drifted', 'ambiguous', 'detached');
CREATE TYPE "ExternalChannelProjectionSourceType" AS ENUM ('outbound_draft', 'document', 'knowledge_article', 'product', 'product_offering', 'catalog_item', 'storefront_section', 'storefront_item', 'marketing_asset');
CREATE TYPE "ExternalChannelResourceKind" AS ENUM ('post', 'page', 'media');

CREATE TABLE "ExternalChannelProjection" (
    "id" TEXT NOT NULL,
    "externalChannelProjectionId" TEXT NOT NULL,
    "connectorKey" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "credentialId" TEXT,
    "sourceType" "ExternalChannelProjectionSourceType" NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "resourceKind" "ExternalChannelResourceKind" NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'und',
    "externalRef" TEXT,
    "externalUrl" TEXT,
    "localFingerprint" TEXT NOT NULL,
    "remoteFingerprint" TEXT,
    "remoteModifiedAt" TIMESTAMP(3),
    "state" "ExternalChannelProjectionState" NOT NULL DEFAULT 'reserved',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectedAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3),
    "driftedAt" TIMESTAMP(3),
    "detachedAt" TIMESTAMP(3),
    "lifecycle" "RecordLifecycle" NOT NULL DEFAULT 'active',
    "lifecycleAt" TIMESTAMP(3),
    "lifecycleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalChannelProjection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalChannelProjection_externalChannelProjectionId_key" ON "ExternalChannelProjection"("externalChannelProjectionId");
CREATE UNIQUE INDEX "ExternalChannelProjection_source_binding_key" ON "ExternalChannelProjection"("connectorKey", "connectionId", "sourceType", "sourceRef", "resourceKind", "locale");
CREATE UNIQUE INDEX "ExternalChannelProjection_remote_binding_key" ON "ExternalChannelProjection"("connectorKey", "connectionId", "resourceKind", "externalRef");
CREATE INDEX "ExternalChannelProjection_connectionId_idx" ON "ExternalChannelProjection"("connectionId");
CREATE INDEX "ExternalChannelProjection_credentialId_idx" ON "ExternalChannelProjection"("credentialId");
CREATE INDEX "ExternalChannelProjection_connectorKey_connectionId_state_updatedAt_idx" ON "ExternalChannelProjection"("connectorKey", "connectionId", "state", "updatedAt");
CREATE INDEX "ExternalChannelProjection_sourceType_sourceRef_idx" ON "ExternalChannelProjection"("sourceType", "sourceRef");

ALTER TABLE "ExternalChannelProjection"
  ADD CONSTRAINT "ExternalChannelProjection_credentialId_fkey"
  FOREIGN KEY ("credentialId") REFERENCES "IntegrationCredential"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ExternalChannelProjection"
  ADD CONSTRAINT "ExternalChannelProjection_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "IntegrationCredential"("integrationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
