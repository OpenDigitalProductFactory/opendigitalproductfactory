-- Additive, nullable configuration preserves all existing credentials.
-- @migration-safety: data-safe: nullable column requires no existing-row backfill.
ALTER TABLE "CredentialEntry" ADD COLUMN "providerWorkspaceId" TEXT;
