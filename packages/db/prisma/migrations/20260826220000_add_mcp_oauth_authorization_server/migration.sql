-- MCP client self-authentication: OAuth 2.1 authorization server (BI-E4DFDCB0).
--
-- Purely additive. One enum, three new tables and three new nullable/defaulted
-- columns on McpApiToken. No existing column is altered, dropped or backfilled,
-- and no existing row changes meaning: a dpfmcp_ PAT row simply has NULL
-- oauthClientId and resource, and an empty publicScopes array. That is what
-- lets this apply cleanly against ANY existing data state, including an install
-- mid-flight with live tokens in use.
--
-- Hand-written rather than `migrate diff`-generated on purpose: the generated
-- diff of the full migration chain against the current schema carries a large
-- amount of unrelated pre-existing drift (dropped finance tables, index
-- renames). Shipping that would have made this migration destructive far beyond
-- its stated scope.

-- CreateEnum: registration mechanism is a closed set, branched on in the token
-- endpoint and shown on the consent screen.
CREATE TYPE "OAuthClientRegistrationKind" AS ENUM ('dcr', 'cimd', 'preregistered', 'credentials');

-- CreateTable: an OAuth client registered against this install's AS.
CREATE TABLE "OAuthClient" (
    "id" TEXT NOT NULL,
    "oAuthClientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "registrationKind" "OAuthClientRegistrationKind" NOT NULL,
    "clientSecretHash" TEXT,
    "clientSecretEnc" TEXT,
    "redirectUris" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownerUserId" TEXT,
    "agentId" TEXT,
    "allowedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable: single-use authorization codes, consumed on first exchange so a
-- replay is detectable rather than silently honoured.
CREATE TABLE "OAuthAuthorizationCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "oauthClientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "resource" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthAuthorizationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable: refresh tokens, rotated on every use. `rotatedToId` points at
-- the successor, so presenting an already-exchanged token is a detectable
-- replay and the whole chain can be revoked.
CREATE TABLE "OAuthRefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "oauthClientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT,
    "resource" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rotatedToId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthRefreshToken_pkey" PRIMARY KEY ("id")
);

-- AlterTable: an OAuth access token and a dpfmcp_ PAT are the same governed
-- object with different issuance paths. All three columns are nullable or
-- defaulted, so every existing PAT row remains valid unchanged.
ALTER TABLE "McpApiToken" ADD COLUMN     "oauthClientId" TEXT,
ADD COLUMN     "publicScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "resource" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OAuthClient_oAuthClientId_key" ON "OAuthClient"("oAuthClientId");

-- CreateIndex
CREATE INDEX "OAuthClient_ownerUserId_revokedAt_idx" ON "OAuthClient"("ownerUserId", "revokedAt");

-- CreateIndex
CREATE INDEX "OAuthClient_registrationKind_revokedAt_idx" ON "OAuthClient"("registrationKind", "revokedAt");

-- CreateIndex
CREATE INDEX "OAuthClient_agentId_idx" ON "OAuthClient"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAuthorizationCode_codeHash_key" ON "OAuthAuthorizationCode"("codeHash");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationCode_oauthClientId_idx" ON "OAuthAuthorizationCode"("oauthClientId");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationCode_userId_idx" ON "OAuthAuthorizationCode"("userId");

-- CreateIndex
CREATE INDEX "OAuthAuthorizationCode_expiresAt_idx" ON "OAuthAuthorizationCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthRefreshToken_tokenHash_key" ON "OAuthRefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "OAuthRefreshToken_oauthClientId_revokedAt_idx" ON "OAuthRefreshToken"("oauthClientId", "revokedAt");

-- CreateIndex
CREATE INDEX "OAuthRefreshToken_userId_revokedAt_idx" ON "OAuthRefreshToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "OAuthRefreshToken_agentId_idx" ON "OAuthRefreshToken"("agentId");

-- CreateIndex
CREATE INDEX "OAuthRefreshToken_rotatedToId_idx" ON "OAuthRefreshToken"("rotatedToId");

-- CreateIndex
CREATE INDEX "McpApiToken_oauthClientId_revokedAt_idx" ON "McpApiToken"("oauthClientId", "revokedAt");

-- AddForeignKey
-- @migration-safety: data-safe: "oauthClientId" is added by THIS migration as a
-- nullable column with no default and no backfill, so every pre-existing
-- McpApiToken row holds NULL. A NULL foreign key is unconstrained by definition
-- (SQL MATCH SIMPLE), so no existing row can violate this constraint on any
-- install, at any data state.
ALTER TABLE "McpApiToken" ADD CONSTRAINT "McpApiToken_oauthClientId_fkey" FOREIGN KEY ("oauthClientId") REFERENCES "OAuthClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- @migration-safety: data-safe: "OAuthClient" is created empty by THIS migration,
-- so there is no row that could violate this constraint.
ALTER TABLE "OAuthClient" ADD CONSTRAINT "OAuthClient_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- @migration-safety: data-safe: "OAuthClient" is created empty by THIS migration.
ALTER TABLE "OAuthClient" ADD CONSTRAINT "OAuthClient_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- @migration-safety: data-safe: "OAuthAuthorizationCode" is created empty by THIS migration.
ALTER TABLE "OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_oauthClientId_fkey" FOREIGN KEY ("oauthClientId") REFERENCES "OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- @migration-safety: data-safe: "OAuthAuthorizationCode" is created empty by THIS migration.
ALTER TABLE "OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- @migration-safety: data-safe: "OAuthRefreshToken" is created empty by THIS migration.
ALTER TABLE "OAuthRefreshToken" ADD CONSTRAINT "OAuthRefreshToken_oauthClientId_fkey" FOREIGN KEY ("oauthClientId") REFERENCES "OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- @migration-safety: data-safe: "OAuthRefreshToken" is created empty by THIS migration.
ALTER TABLE "OAuthRefreshToken" ADD CONSTRAINT "OAuthRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- @migration-safety: data-safe: "OAuthRefreshToken" is created empty by THIS migration.
ALTER TABLE "OAuthRefreshToken" ADD CONSTRAINT "OAuthRefreshToken_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- @migration-safety: data-safe: "OAuthRefreshToken" is created empty by THIS migration, so
-- the self-referencing rotation chain has no pre-existing row to validate.
ALTER TABLE "OAuthRefreshToken" ADD CONSTRAINT "OAuthRefreshToken_rotatedToId_fkey" FOREIGN KEY ("rotatedToId") REFERENCES "OAuthRefreshToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
