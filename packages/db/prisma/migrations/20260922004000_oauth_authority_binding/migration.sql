-- @migration-safety: data-safe: Every new foreign key column is nullable and newly added; all existing rows are NULL, with no inferred backfill.
-- Additive only. Existing credentials remain unbound and require fresh consent.
-- No identity is inferred from client names or legacy credential rows.
CREATE TYPE "OAuthBindingPurpose" AS ENUM ('delegation', 'consent');
ALTER TABLE "AuthorityBinding" ADD COLUMN "oauthPurpose" "OAuthBindingPurpose",
  ADD COLUMN "oauthUserId" TEXT, ADD COLUMN "oauthClientId" TEXT;
ALTER TABLE "AuthorityBinding" ADD CONSTRAINT "AuthorityBinding_oauthClientId_fkey"
  FOREIGN KEY ("oauthClientId") REFERENCES "OAuthClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AuthorityBinding_oauthUserId_oauthClientId_oauthPurpose_status_idx"
  ON "AuthorityBinding"("oauthUserId", "oauthClientId", "oauthPurpose", "status");
CREATE INDEX "AuthorityBinding_oauthClientId_idx" ON "AuthorityBinding"("oauthClientId");
ALTER TABLE "AuthorityBinding" ADD CONSTRAINT "AuthorityBinding_oauthUserId_fkey"
  FOREIGN KEY ("oauthUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OAuthAuthorizationCode" ADD COLUMN "authorityBindingId" TEXT;
ALTER TABLE "McpApiToken" ADD COLUMN "authorityBindingId" TEXT, ADD COLUMN "oauthFamilyKey" TEXT;
ALTER TABLE "OAuthRefreshToken" ADD COLUMN "authorityBindingId" TEXT, ADD COLUMN "oauthFamilyKey" TEXT;
ALTER TABLE "OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_authorityBindingId_fkey"
  FOREIGN KEY ("authorityBindingId") REFERENCES "AuthorityBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "McpApiToken" ADD CONSTRAINT "McpApiToken_authorityBindingId_fkey"
  FOREIGN KEY ("authorityBindingId") REFERENCES "AuthorityBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OAuthRefreshToken" ADD CONSTRAINT "OAuthRefreshToken_authorityBindingId_fkey"
  FOREIGN KEY ("authorityBindingId") REFERENCES "AuthorityBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "OAuthAuthorizationCode_authorityBindingId_idx" ON "OAuthAuthorizationCode"("authorityBindingId");
CREATE INDEX "McpApiToken_authorityBindingId_idx" ON "McpApiToken"("authorityBindingId");
CREATE INDEX "OAuthRefreshToken_authorityBindingId_idx" ON "OAuthRefreshToken"("authorityBindingId");
CREATE INDEX "McpApiToken_oauthFamilyKey_revokedAt_idx" ON "McpApiToken"("oauthFamilyKey", "revokedAt");
CREATE INDEX "OAuthRefreshToken_oauthFamilyKey_revokedAt_idx" ON "OAuthRefreshToken"("oauthFamilyKey", "revokedAt");
