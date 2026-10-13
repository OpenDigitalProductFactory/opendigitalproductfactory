-- Expand only: existing provider-default credentials and their unique lookup survive.
ALTER TABLE "CredentialEntry" ALTER COLUMN "providerId" DROP NOT NULL;
ALTER TABLE "AiProviderConnection" ADD COLUMN "accessibleModelIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "modelsVerifiedAt" TIMESTAMP(3);
ALTER TABLE "OAuthPendingFlow" ADD COLUMN "connectionId" TEXT;
CREATE INDEX "OAuthPendingFlow_connectionId_idx" ON "OAuthPendingFlow"("connectionId");
-- @migration-safety: data-safe: the new nullable column contains no references.
ALTER TABLE "OAuthPendingFlow" ADD CONSTRAINT "OAuthPendingFlow_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "AiProviderConnection"("connectionId") ON DELETE CASCADE ON UPDATE CASCADE;
-- Attach existing defaults only when neither side is already owned elsewhere.
UPDATE "AiProviderConnection" AS connection SET "credentialEntryId" = credential."id"
FROM "CredentialEntry" AS credential
WHERE connection."connectionId" = 'provider-default-' || credential."providerId"
  AND connection."credentialEntryId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "AiProviderConnection" AS owner WHERE owner."credentialEntryId" = credential."id");
